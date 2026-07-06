"""User-mask inpainting jobs.

``POST /api/inpaint`` — repaint a hand-painted region of a source (gallery id or
uploaded data URL) via a selectable inpaint engine + prompt; saves result(s) to the
gallery at source resolution. Mask supplied as a data URL (white = repaint). Polled via
``GET /api/inpaint/{job_id}`` (BatchProgress shape, shared live-stats UI). Uses the
shared ``services.jobs`` store; publishes ``inpaint:{job_id}`` wakes to the WebSocket
pusher.
"""
from __future__ import annotations

import random
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import live, messages, samplers
from ..services import (
    downloader,
    gallery,
    inpaint as inpaint_svc,
    inpaint_engine,
    job_guard,
    jobs,
    upscalers,
)
from ..services.upscalers import UpscalerInfo
from .upscale import BatchProgress

router = APIRouter(prefix="/api/inpaint", tags=["inpaint"])

_SEED_MAX = 2**32 - 1


class InpaintRequest(BaseModel):
    image_id: str | None = None   # source: an existing gallery image
    image_data: str | None = None  # source: an uploaded image as a data URL
    mask_data: str  # painted mask as a data URL (white = repaint, black = keep)
    # Inpaint engine (slug); None → the curated default inpaint model.
    engine: str | None = None
    prompt: str = ""  # what to draw inside the painted area
    # Per-run negative prompt; appended to the configurable Settings default.
    negative: str = ""
    # Feather tuning (0..1; 0.5 = tuned default): mask-edge gradient fed to the
    # diffuser, composite-back seam fade, and seed blur under the mask.
    mask_softness: float = Field(default=0.5, ge=0.0, le=1.0)
    seam_softness: float = Field(default=0.5, ge=0.0, le=1.0)
    seed_softness: float = Field(default=0.5, ge=0.0, le=1.0)
    # Grow the painted region outward before generating (0..1), to swallow a subject's
    # soft fringe so no halo of the original remains at the edge.
    mask_expand: float = Field(default=0.0, ge=0.0, le=1.0)
    # Generation parameters: inpaint/refine step counts, CFG scale, scheduler id,
    # RNG seed (None → random), and how many variants to generate (incrementing seeds).
    steps: int = Field(default=inpaint_engine.DEFAULT_STEPS, ge=1, le=150)
    refine_steps: int = Field(default=inpaint_engine.DEFAULT_REFINE_STEPS, ge=1, le=150)
    # Whether to run the slow full-resolution hires refine pass on large crops.
    refine: bool = False
    guidance: float = Field(default=inpaint_engine.DEFAULT_GUIDANCE, ge=0.0, le=30.0)
    sampler: str | None = None
    seed: int | None = None
    batch: int = Field(default=1, ge=1, le=8)


class InpaintStarted(BaseModel):
    job_id: str


_store: jobs.JobStore[jobs.JobState] = jobs.JobStore("inpaint")


def _run(job: jobs.JobState, req: InpaintRequest, image, mask, engine: UpscalerInfo) -> None:
    pub_key = f"inpaint:{job.job_id}"
    on_progress = jobs.make_on_progress(job, _store.lock, pub_key)

    base_seed = req.seed if req.seed is not None else random.randint(0, _SEED_MAX)
    sampler = req.sampler or samplers.DEFAULT_SAMPLER
    with _store.lock:
        job.batch_size = req.batch
    try:
        for i in range(req.batch):
            seed_i = (base_seed + i) % (_SEED_MAX + 1)
            with _store.lock:
                job.batch_index = i + 1
            result = inpaint_svc.inpaint_image(
                image, mask, req.prompt, on_progress, engine,
                mask_softness=req.mask_softness,
                seam_softness=req.seam_softness,
                seed_softness=req.seed_softness,
                mask_expand=req.mask_expand,
                negative=req.negative,
                steps=req.steps,
                refine_steps=req.refine_steps,
                refine=req.refine,
                guidance=req.guidance,
                sampler=req.sampler,
                seed=seed_i,
            )
            with _store.lock:
                job.phase = "finalizing"
            live.publish(pub_key)
            jobs.save_result(
                _store,
                job,
                result,
                {
                    "model_slug": engine.slug,
                    "model_name": engine.name,
                    "prompt": req.prompt or "Inpaint",
                    "negative_prompt": req.negative or None,
                    "steps": req.steps,
                    "guidance_scale": req.guidance,
                    "width": result.width,
                    "height": result.height,
                    "seed": seed_i,
                    "sampler": sampler,
                },
            )
        with _store.lock:
            job.status = "done"
        live.publish(pub_key)
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI via job state
        with _store.lock:
            job.status = "error"
            job.error = messages.INPAINT_FAILED.format(detail=str(exc))
        live.publish(pub_key)
    finally:
        inpaint_engine.unload()  # free the inpaint pipe
        job_guard.release(job.job_id)


@router.post("", response_model=InpaintStarted)
def start_inpaint(req: InpaintRequest) -> InpaintStarted:
    engine = upscalers.get(req.engine or upscalers.INPAINT_SLUG)
    if engine is None or engine.kind != "inpaint":
        raise HTTPException(404, messages.INPAINT_ENGINE_INVALID.format(slug=req.engine))
    if not downloader.is_downloaded(engine.slug):
        raise HTTPException(409, messages.INPAINT_MODEL_MISSING)

    try:
        image = jobs.resolve_source(req, messages.INPAINT_SOURCE_MISSING)
        mask = gallery.decode_data_url(req.mask_data, messages.INPAINT_MASK_MISSING)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    with _store.lock:
        job = jobs.JobState(_store.new_id(), engine.name)
    busy = job_guard.acquire(job.job_id, "inpaint")
    if busy is not None:
        raise HTTPException(409, messages.JOB_BUSY.format(kind=busy))
    with _store.lock:
        _store.add(job)

    thread = threading.Thread(
        target=_run, args=(job, req, image, mask, engine), daemon=True
    )
    thread.start()
    return InpaintStarted(job_id=job.job_id)


@router.get("/{job_id}", response_model=BatchProgress)
def inpaint_progress(job_id: str) -> BatchProgress:
    with _store.lock:
        job = _store.get(job_id)
        if job is None:
            raise HTTPException(404, messages.JOB_NOT_FOUND.format(job_id=job_id))
        return BatchProgress(
            job_id=job.job_id,
            status=job.status,
            phase=job.phase,
            current_tile=job.current_tile,
            total_tiles=job.total_tiles,
            current_step=job.current_step,
            total_steps=job.total_steps,
            its=job.its,
            elapsed=round(job.elapsed(), 1),
            engine_name=job.engine_name,
            image_id=job.image_id,
            error=job.error,
            batch_index=job.batch_index,
            batch_size=job.batch_size,
            image_ids=list(job.image_ids),
        )
