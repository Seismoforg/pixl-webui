"""Text-to-image generation as a background job with live step progress.

``POST /api/generate`` → starts on a background thread, returns ``job_id`` at once.
The diffusers step callback updates a per-job record (current step, its/s), polled via
``GET /api/generate/{job_id}``. On success the image is saved to the gallery + its
``image_id`` reported back. Reuses the shared ``services.jobs`` store.
"""
from __future__ import annotations

import random
import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import live, messages, samplers
from ..catalog import get_model
from ..services import downloader, gallery, job_guard, jobs, loras as loras_svc, pipeline

router = APIRouter(prefix="/api", tags=["generate"])


class LoraRef(BaseModel):
    slug: str
    weight: float = Field(default=1.0, ge=0.0, le=2.0)


class GenerateRequest(BaseModel):
    slug: str
    prompt: str = Field(min_length=1)
    negative_prompt: str | None = None
    steps: int = Field(default=30, ge=1, le=150)
    guidance_scale: float = Field(default=7.0, ge=0, le=30)
    width: int = Field(default=1024, ge=128, le=2048)
    height: int = Field(default=1024, ge=128, le=2048)
    seed: int | None = None
    sampler: str = samplers.DEFAULT_SAMPLER
    preview: bool = False
    batch: int = Field(default=1, ge=1, le=8)
    # Optional reference image (data URL) + how to use it.
    reference_image: str | None = None
    reference_mode: str = "img2img"  # "img2img" | "style"
    strength: float = Field(default=0.6, ge=0.05, le=1.0)
    ip_adapter_scale: float = Field(default=0.6, ge=0.0, le=1.0)
    # LoRA adapters to blend into this run (each family-matched + downloaded).
    loras: list[LoraRef] = []


class GenerateStarted(BaseModel):
    job_id: str


class SamplerList(BaseModel):
    samplers: list[samplers.Sampler]
    default: str


class PhaseTimings(BaseModel):
    """Per-image wall-clock breakdown (seconds): how long each phase took."""

    load: float  # model load + prompt encoding (until the first denoising step)
    generate: float  # the denoising steps
    decode: float  # VAE decode of the latents into the final image ("finalizing")
    total: float  # load + generate + decode


class GenerationProgress(BaseModel):
    job_id: str
    status: str  # "running" | "done" | "error"
    phase: str  # "loading" | "generating" | "finalizing"
    current_step: int
    total_steps: int
    its: float | None  # iterations per second, None until measurable
    seed: int  # base seed; image k of the batch uses seed + k
    prompt: str
    batch_size: int
    batch_index: int  # 1-based index of the image currently generating
    image_ids: list[str] = []  # accumulates as each batch image finishes
    # One timing breakdown per finished image, aligned with image_ids.
    timings: list[PhaseTimings] = []
    preview: str | None = None  # data URL of the latest in-progress frame
    image_id: str | None = None  # first image (kept for single-image compatibility)
    error: str | None = None


class _Job:
    """Mutable in-process state for one generation."""

    def __init__(
        self, job_id: str, seed: int, total_steps: int, prompt: str, batch_size: int
    ) -> None:
        self.job_id = job_id
        self.status = "running"
        # loading: model load + prompt encoding (before step 1)
        # generating: denoising steps running
        # finalizing: VAE decode of the latents into a PNG (after the last step)
        self.phase = "loading"
        self.current_step = 0
        self.total_steps = total_steps
        self.seed = seed
        self.prompt = prompt
        self.batch_size = batch_size
        self.batch_index = 0
        # Gallery ids of finished batch images, in order (grows during the batch).
        self.image_ids: list[str] = []
        # Per-image phase breakdown, aligned with image_ids (see PhaseTimings).
        self.image_timings: list[dict] = []
        # Latest live preview frame (data URL); only the most recent is kept.
        self.preview: str | None = None
        self.error: str | None = None
        # Timing starts at the first step so model-load time is excluded from the
        # reported speed. ``first_step_at`` covers the elapsed time for the steps
        # taken *after* the first one.
        self.first_step_at: float | None = None
        # Per-image phase markers (perf_counter), reset each batch round: the image
        # started, the last step finished (decode start), and the image was saved.
        self.load_started_at: float | None = None
        self.decode_started_at: float | None = None

    def its(self) -> float | None:
        if self.first_step_at is None or self.current_step <= 1:
            return None
        elapsed = time.perf_counter() - self.first_step_at
        if elapsed <= 0:
            return None
        return (self.current_step - 1) / elapsed


_store: jobs.JobStore[_Job] = jobs.JobStore("gen")


def _run(job: _Job, req: GenerateRequest, model, init_image) -> None:
    # Wakes the WebSocket pusher after each state change so progress is pushed with
    # no tick latency (a no-op when nobody is subscribed).
    key = f"generation:{job.job_id}"

    def on_step(completed: int) -> None:
        # Some pipelines invoke the callback one extra time; clamp so the UI never
        # shows "step n+1 / n".
        with _store.lock:
            if job.first_step_at is None:
                job.first_step_at = time.perf_counter()
            completed = min(completed, job.total_steps)
            job.current_step = completed
            # After the last denoising step the pipeline runs the VAE decode; flag
            # that tail so the UI can show a distinct "finalizing" phase, and stamp
            # its start so the decode duration can be measured.
            if completed >= job.total_steps:
                job.phase = "finalizing"
                if job.decode_started_at is None:
                    job.decode_started_at = time.perf_counter()
            else:
                job.phase = "generating"
        live.publish(key)

    def on_preview(data_url: str) -> None:
        with _store.lock:
            job.preview = data_url
        live.publish(key)

    try:
        # Generate the batch sequentially, reusing the cached pipeline. Each image
        # uses an incrementing seed (base + index) so results vary yet stay
        # reproducible; per-image step/timing/preview state is reset each round.
        for i in range(job.batch_size):
            with _store.lock:
                job.batch_index = i + 1
                job.current_step = 0
                job.first_step_at = None
                job.decode_started_at = None
                job.load_started_at = time.perf_counter()
                job.phase = "loading"
                job.preview = None
            live.publish(key)

            seed_i = (job.seed + i) % (jobs.SEED_MAX + 1)
            image, effective_sampler = pipeline.generate(
                model=model,
                prompt=req.prompt,
                negative_prompt=req.negative_prompt,
                steps=req.steps,
                guidance_scale=req.guidance_scale,
                width=req.width,
                height=req.height,
                seed=seed_i,
                sampler=req.sampler,
                preview=req.preview,
                init_image=init_image,
                reference_mode=req.reference_mode,
                strength=req.strength,
                ip_adapter_scale=req.ip_adapter_scale,
                loras=[(lora.slug, lora.weight) for lora in req.loras],
                on_step=on_step,
                on_preview=on_preview,
            )
            meta = gallery.save(
                image,
                {
                    "model_slug": model.slug,
                    "model_name": model.name,
                    "prompt": req.prompt,
                    "negative_prompt": req.negative_prompt,
                    "steps": req.steps,
                    "guidance_scale": req.guidance_scale,
                    "width": req.width,
                    "height": req.height,
                    "seed": seed_i,
                    "sampler": effective_sampler,
                    "loras": [f"{lora.slug}@{lora.weight}" for lora in req.loras],
                },
            )
            done_at = time.perf_counter()
            with _store.lock:
                job.current_step = job.total_steps
                job.image_ids.append(meta.id)
                # Build this image's phase breakdown from the perf_counter markers.
                # Every marker is set by this point (loop start / first step / last
                # step); fall back to done_at so a duration is never negative.
                load_at = job.load_started_at or done_at
                gen_at = job.first_step_at or done_at
                dec_at = job.decode_started_at or done_at
                job.image_timings.append(
                    {
                        "load": max(0.0, gen_at - load_at),
                        "generate": max(0.0, dec_at - gen_at),
                        "decode": max(0.0, done_at - dec_at),
                        "total": max(0.0, done_at - load_at),
                    }
                )
            live.publish(key)

        with _store.lock:
            job.status = "done"
        live.publish(key)
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI via job state
        with _store.lock:
            job.status = "error"
            job.error = messages.GENERATION_FAILED.format(detail=str(exc))
        live.publish(key)
    finally:
        job_guard.release(job.job_id)


@router.get("/samplers", response_model=SamplerList)
def list_samplers() -> SamplerList:
    return SamplerList(samplers=samplers.list_samplers(), default=samplers.DEFAULT_SAMPLER)


@router.post("/generate", response_model=GenerateStarted)
def start_generation(req: GenerateRequest) -> GenerateStarted:
    model = get_model(req.slug)
    if model is None:
        raise HTTPException(404, messages.MODEL_NOT_FOUND.format(slug=req.slug))

    # Decode the optional reference here (like the other job routers resolve their
    # source in the handler) so a bad image is a 400, not a started-then-failed job.
    try:
        init_image = (
            gallery.decode_data_url(req.reference_image, messages.REFERENCE_DECODE_FAILED)
            if req.reference_image
            else None
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    # Validate any requested LoRAs up front (exists / downloaded / family match) so a
    # bad selection is a 400 rather than a started-then-failed job.
    for ref in req.loras:
        lora = loras_svc.get(ref.slug)
        if lora is None:
            raise HTTPException(404, messages.LORA_NOT_FOUND.format(slug=ref.slug))
        if model.is_gguf:
            raise HTTPException(400, messages.LORA_GGUF_UNSUPPORTED)
        if lora.family != model.family:
            raise HTTPException(
                400,
                messages.LORA_INCOMPATIBLE.format(
                    name=lora.name, lora_family=lora.family, family=model.family
                ),
            )
        if not downloader.is_downloaded(ref.slug):
            raise HTTPException(400, messages.LORA_NOT_DOWNLOADED.format(slug=ref.slug))

    with _store.lock:
        seed = req.seed if req.seed is not None else random.randint(0, jobs.SEED_MAX)
        job = _Job(
            _store.new_id(),
            seed=seed,
            total_steps=req.steps,
            prompt=req.prompt,
            batch_size=req.batch,
        )
    # One heavy GPU job across the whole process (generation/upscale/reframe/inpaint/edit).
    busy = job_guard.acquire(job.job_id, "generation")
    if busy is not None:
        raise HTTPException(409, messages.JOB_BUSY.format(kind=busy))
    with _store.lock:
        _store.add(job)

    thread = threading.Thread(target=_run, args=(job, req, model, init_image), daemon=True)
    thread.start()
    return GenerateStarted(job_id=job.job_id)


@router.get("/generate/{job_id}", response_model=GenerationProgress)
def generation_progress(job_id: str) -> GenerationProgress:
    with _store.lock:
        job = _store.get(job_id)
        if job is None:
            raise HTTPException(404, messages.JOB_NOT_FOUND.format(job_id=job_id))
        return GenerationProgress(
            job_id=job.job_id,
            status=job.status,
            phase=job.phase,
            current_step=job.current_step,
            total_steps=job.total_steps,
            its=job.its(),
            seed=job.seed,
            prompt=job.prompt,
            batch_size=job.batch_size,
            batch_index=job.batch_index,
            image_ids=list(job.image_ids),
            timings=[PhaseTimings(**t) for t in job.image_timings],
            preview=job.preview,
            image_id=job.image_ids[0] if job.image_ids else None,
            error=job.error,
        )
