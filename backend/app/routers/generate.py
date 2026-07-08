"""Text-to-image generation as a background job with live step progress.

``POST /api/generate`` → starts on a background thread, returns ``job_id`` at once.
The diffusers step callback updates a per-job record (current step, its/s), polled via
``GET /api/generate/{job_id}``. On success the image is saved to the gallery + its
``image_id`` reported back. Reuses the shared ``services.jobs`` store.
"""
from __future__ import annotations

import random

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import live, messages, samplers
from ..catalog import get_model
from ..services import downloader, gallery, jobs, loras as loras_svc, pipeline
from ..services.jobs import LoraRef, PhaseTimings

router = APIRouter(prefix="/api", tags=["generate"])


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


class _Job(jobs.JobState):
    """Generation job = the shared JobState (phases loading | generating | finalizing,
    batch + per-image timing markers) plus the generation-only response fields."""

    def __init__(
        self, job_id: str, *, model_name: str, seed: int, total_steps: int,
        prompt: str, batch_size: int,
    ) -> None:
        super().__init__(job_id, model_name)
        self.seed = seed
        self.total_steps = total_steps
        self.prompt = prompt
        self.batch_size = batch_size
        # Latest live preview frame (data URL); only the most recent is kept.
        self.preview: str | None = None


_store: jobs.JobStore[_Job] = jobs.JobStore("gen")


def _run(job: _Job, req: GenerateRequest, model, init_image) -> None:
    # Wakes the WebSocket pusher after each state change so progress is pushed with
    # no tick latency (a no-op when nobody is subscribed).
    key = f"generation:{job.job_id}"
    on_step = jobs.make_on_step(job, _store.lock, key, running_phase="generating")

    def on_preview(data_url: str) -> None:
        with _store.lock:
            job.preview = data_url
        live.publish(key)

    def on_item_start() -> None:
        # run_batch already reset the timing markers (start_image); also reset the
        # visible per-round state and push it so the UI flips back to "loading".
        with _store.lock:
            job.current_step = 0
            job.its = None
            job.phase = "loading"
            job.preview = None
        live.publish(key)

    # pipeline.generate returns (image, effective_sampler); the meta builder needs the
    # sampler that actually ran, so render stashes it beside the returned image.
    effective = {"sampler": req.sampler}

    def render(_i: int, seed_i: int):
        image, effective["sampler"] = pipeline.generate(
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
        return image

    def meta(seed_i: int, _result) -> dict:
        return {
            "model_slug": model.slug,
            "model_name": model.name,
            "prompt": req.prompt,
            "negative_prompt": req.negative_prompt,
            "steps": req.steps,
            "guidance_scale": req.guidance_scale,
            "width": req.width,
            "height": req.height,
            "seed": seed_i,
            "sampler": effective["sampler"],
            "loras": [f"{lora.slug}@{lora.weight}" for lora in req.loras],
        }

    # No unload: the generation pipe stays cached across runs (model-switch unloads).
    with jobs.job_run(_store, job, key, messages.GENERATION_FAILED):
        jobs.run_batch(
            _store, job, key,
            batch=job.batch_size, seed=job.seed,
            render=render, meta=meta, on_item_start=on_item_start,
        )


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

    # An img2img reference run denoises only int(steps * strength) steps (diffusers
    # get_timesteps), so track that as the total — else progress caps below 100% and
    # the "finalizing" phase never fires. Style (IP-Adapter) + no-reference run full steps.
    is_img2img = init_image is not None and req.reference_mode == "img2img"
    total_steps = max(1, int(req.steps * req.strength)) if is_img2img else req.steps

    seed = req.seed if req.seed is not None else random.randint(0, jobs.SEED_MAX)
    job = jobs.start_job(
        _store, "generation", _run, req, model, init_image,
        make_job=lambda job_id: _Job(
            job_id, model_name=model.name, seed=seed, total_steps=total_steps,
            prompt=req.prompt, batch_size=req.batch,
        ),
    )
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
            its=job.its,
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
