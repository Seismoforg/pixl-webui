"""Aspect-ratio reframing jobs (no upscaling).

``POST /api/reframe`` — reframe a source (gallery id or uploaded data URL) to a target
ratio via a non-AI strategy (cover/contain/edge) or an AI outpaint pass; saves to the
gallery at source resolution, never upscales. Polled via ``GET /api/reframe/{job_id}``
(BatchProgress shape, shared live-stats UI). Uses the shared ``services.jobs`` store;
publishes ``reframe:{job_id}`` wakes to the WebSocket pusher.
"""
from __future__ import annotations

import random
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import live, messages, samplers
from ..services import (
    downloader,
    inpaint_engine,
    job_guard,
    jobs,
    outpaint as outpaint_svc,
    reframe as reframe_svc,
    upscalers,
)
from ..services.upscalers import UpscalerInfo
from ..services.jobs import BatchProgress

router = APIRouter(prefix="/api/reframe", tags=["reframe"])


class ReframeRequest(BaseModel):
    image_id: str | None = None   # source: an existing gallery image
    image_data: str | None = None  # source: an uploaded image as a data URL
    # Target aspect ratio (e.g. "16:9"); "original"/invalid is rejected — reframing
    # always changes the ratio. For a custom resolution the frontend sends "WxH"
    # (parse_ratio derives the aspect) plus target_width/target_height below.
    target_ratio: str
    # Custom exact output resolution (pixels). When BOTH are set, the result is
    # resized to exactly this size (may upscale); None → the size is derived from the
    # source + ratio (the default reframe behavior, no upscaling).
    target_width: int | None = Field(default=None, ge=64, le=4096)
    target_height: int | None = Field(default=None, ge=64, le=4096)
    reframe: str = "cover"  # "cover" | "contain" | "edge" | "outpaint"
    outpaint_prompt: str = ""  # describes the scene generated in the outpainted area
    # Per-run negative prompt for outpaint; appended to the configurable Settings
    # default (Settings.outpaint_negative).
    outpaint_negative: str = ""
    # Inpaint engine (slug) used for reframe=outpaint; None → the curated default.
    outpaint_engine: str | None = None
    # Seam-blend tuning for reframe=outpaint (0..1; 0.5 = tuned default). Scale the
    # outpaint mask gradient band, the composite-back seam fade, and the reflected-
    # seed blur. Ignored by cover/contain/edge.
    mask_softness: float = Field(default=0.5, ge=0.0, le=1.0)
    seam_softness: float = Field(default=0.5, ge=0.0, le=1.0)
    seed_softness: float = Field(default=0.5, ge=0.0, le=1.0)
    # Source placement within the extended canvas (0..1; 0.5 = centred). Applies to
    # the area-adding strategies (outpaint/contain/edge); cover ignores it.
    pos_x: float = Field(default=0.5, ge=0.0, le=1.0)
    pos_y: float = Field(default=0.5, ge=0.0, le=1.0)
    # Source scale within the frame (0..1; 1 = fills the fitting axis). < 1 shrinks the
    # source inside a larger canvas so it can be positioned with room around it (the
    # area-adding strategies outpaint/contain/edge; cover ignores it).
    scale: float = Field(default=1.0, ge=0.1, le=1.0)
    # Generation parameters for reframe=outpaint (ignored by cover/contain/edge):
    # composition/refinement step counts, CFG scale, scheduler id, RNG seed
    # (None → random), and how many variants to generate (incrementing seeds).
    outpaint_steps: int = Field(default=inpaint_engine.DEFAULT_STEPS, ge=1, le=150)
    outpaint_refine_steps: int = Field(default=inpaint_engine.DEFAULT_REFINE_STEPS, ge=1, le=150)
    # Whether to run the (slow, full-resolution) hires refinement pass on large
    # canvases. Off by default — see outpaint._reframe_single.
    outpaint_refine: bool = False
    outpaint_guidance: float = Field(default=inpaint_engine.DEFAULT_GUIDANCE, ge=0.0, le=30.0)
    outpaint_sampler: str | None = None
    outpaint_seed: int | None = None
    outpaint_batch: int = Field(default=1, ge=1, le=8)


class ReframeStarted(BaseModel):
    job_id: str


_store: jobs.JobStore[jobs.JobState] = jobs.JobStore("reframe")


def _run(
    job: jobs.JobState,
    req: ReframeRequest,
    image,
    ratio: tuple[float, float],
    outpaint_engine: UpscalerInfo | None,
) -> None:
    # Wakes the WebSocket pusher after each state change (no-op with no subscriber).
    pub_key = f"reframe:{job.job_id}"
    on_progress = jobs.make_on_progress(job, _store.lock, pub_key)

    strategy = req.reframe
    is_outpaint = strategy == "outpaint" and outpaint_engine is not None

    try:
        if is_outpaint:
            _run_outpaint(job, req, image, ratio, outpaint_engine, on_progress, pub_key)
        else:
            # cover / contain / edge are cheap PIL ops — no engine, near-instant.
            result = reframe_svc.apply(
                image.convert("RGB"), ratio, strategy, req.pos_x, req.pos_y, req.scale
            )
            with _store.lock:
                job.phase = "finalizing"
                job.mark_decode()
            live.publish(pub_key)
            _save_result(job, req, result, "reframe", "Reframe", steps=0, guidance=0.0, seed=0,
                         sampler="reframe")
        with _store.lock:
            job.status = "done"
        live.publish(pub_key)
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI via job state
        with _store.lock:
            job.status = "error"
            job.error = messages.REFRAME_FAILED.format(detail=str(exc))
        live.publish(pub_key)
    finally:
        # No pipe unload here: only the outpaint path loads one, so its unload lives
        # with the load in _run_outpaint's finally (cover/contain/edge are pure PIL).
        job_guard.release(job.job_id)


def _run_outpaint(job, req, image, ratio, engine, on_progress, pub_key) -> None:
    """Generate ``batch`` outpaint variants with incrementing seeds; each is
    composited back pixel-exact and saved. The inpaint pipe is loaded once (cached
    across the batch) and freed afterwards. No upscaler runs."""
    base_seed = req.outpaint_seed if req.outpaint_seed is not None else random.randint(0, jobs.SEED_MAX)
    sampler = req.outpaint_sampler or samplers.DEFAULT_SAMPLER
    with _store.lock:
        job.batch_size = req.outpaint_batch
    try:
        for i in range(req.outpaint_batch):
            seed_i = (base_seed + i) % (jobs.SEED_MAX + 1)
            with _store.lock:
                job.batch_index = i + 1
                job.start_image()
            result = outpaint_svc.reframe_image(
                image, ratio, req.outpaint_prompt, on_progress, engine,
                mask_softness=req.mask_softness,
                seam_softness=req.seam_softness,
                seed_softness=req.seed_softness,
                pos_x=req.pos_x, pos_y=req.pos_y, scale=req.scale,
                negative=req.outpaint_negative,
                steps=req.outpaint_steps,
                refine_steps=req.outpaint_refine_steps,
                refine=req.outpaint_refine,
                guidance=req.outpaint_guidance,
                sampler=req.outpaint_sampler,
                seed=seed_i,
            )
            with _store.lock:
                job.phase = "finalizing"
                job.mark_decode()
            live.publish(pub_key)
            _save_result(
                job, req, result, engine.slug, engine.name,
                steps=req.outpaint_steps, guidance=req.outpaint_guidance,
                seed=seed_i, sampler=sampler,
            )
    finally:
        outpaint_svc.unload()  # free the inpaint pipe


def _save_result(job, req, result, model_slug, model_name, *, steps, guidance, seed, sampler) -> None:
    """Resize to a custom target (if any), then persist + record via jobs.save_result."""
    # Custom target resolution: resize to the exact size after the strategy has set
    # the aspect (single choke point for both the PIL and outpaint paths).
    result = reframe_svc.to_exact_size(result, req.target_width, req.target_height)
    jobs.save_result(
        _store,
        job,
        result,
        {
            "model_slug": model_slug,
            "model_name": model_name,
            "prompt": f"Reframed · {req.target_ratio} · {req.reframe}",
            "negative_prompt": req.outpaint_negative or None,
            "steps": steps,
            "guidance_scale": guidance,
            "width": result.width,
            "height": result.height,
            "seed": seed,
            "sampler": sampler,
        },
    )


@router.post("", response_model=ReframeStarted)
def start_reframe(req: ReframeRequest) -> ReframeStarted:
    ratio = reframe_svc.parse_ratio(req.target_ratio)
    if ratio is None:
        raise HTTPException(400, messages.REFRAME_RATIO_REQUIRED)

    # Custom resolution needs BOTH dimensions (the Field bounds enforce 64–4096).
    if (req.target_width is None) != (req.target_height is None):
        raise HTTPException(400, messages.REFRAME_SIZE_INVALID)

    # Outpaint needs the selected inpaint model on disk.
    outpaint_engine: UpscalerInfo | None = None
    if req.reframe == "outpaint":
        outpaint_engine = upscalers.get(req.outpaint_engine or upscalers.INPAINT_SLUG)
        if outpaint_engine is None or outpaint_engine.kind != "inpaint":
            raise HTTPException(
                404, messages.OUTPAINT_ENGINE_INVALID.format(slug=req.outpaint_engine)
            )
        if not downloader.is_downloaded(outpaint_engine.slug):
            raise HTTPException(409, messages.OUTPAINT_MODEL_MISSING)

    try:
        image = jobs.resolve_source(req, messages.REFRAME_SOURCE_MISSING)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    engine_name = outpaint_engine.name if outpaint_engine else "Reframe"
    with _store.lock:
        job = jobs.JobState(_store.new_id(), engine_name)
    busy = job_guard.acquire(job.job_id, "reframe")
    if busy is not None:
        raise HTTPException(409, messages.JOB_BUSY.format(kind=busy))
    with _store.lock:
        _store.add(job)

    thread = threading.Thread(
        target=_run,
        args=(job, req, image, ratio, outpaint_engine),
        daemon=True,
    )
    thread.start()
    return ReframeStarted(job_id=job.job_id)


@router.get("/{job_id}", response_model=BatchProgress)
def reframe_progress(job_id: str) -> BatchProgress:
    with _store.lock:
        job = _store.get(job_id)
        if job is None:
            raise HTTPException(404, messages.JOB_NOT_FOUND.format(job_id=job_id))
        return jobs.to_batch_progress(job)
