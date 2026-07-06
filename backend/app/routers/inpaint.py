"""User-mask inpainting jobs.

``POST /api/inpaint`` repaints a hand-painted region of a source image (a stored
gallery image or an uploaded data URL) using a selectable inpaint engine and a
prompt, and saves the result(s) to the gallery at the source resolution. The user
supplies the mask as a data URL (white = repaint). Polled via
``GET /api/inpaint/{job_id}``; the progress payload reuses the reframe/upscale job
shape so the frontend shares the live-stats UI.

Mirrors the reframe router's per-job store + background thread and publishes
``inpaint:{job_id}`` wakes to the WebSocket pusher.
"""
from __future__ import annotations

import random
import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import live, messages, samplers
from ..services import (
    downloader,
    gallery,
    inpaint as inpaint_svc,
    inpaint_engine,
    job_guard,
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


class _Job:
    def __init__(self, job_id: str, engine_name: str) -> None:
        self.job_id = job_id
        self.status = "running"
        self.phase = "loading"
        self.current_tile = 0
        self.total_tiles = 0
        self.current_step = 0
        self.total_steps = 0
        self.its: float | None = None
        self.engine_name = engine_name
        self.started_at = time.perf_counter()
        self.image_id: str | None = None
        self.batch_index = 0
        self.batch_size = 1
        self.image_ids: list[str] = []
        self.error: str | None = None

    def elapsed(self) -> float:
        return time.perf_counter() - self.started_at


_jobs: dict[str, _Job] = {}
_lock = threading.Lock()
_counter = 0


def _new_job_id() -> str:
    global _counter
    _counter += 1
    return f"inpaint-{_counter}"


def _resolve_source(req: InpaintRequest):
    """Load the source PIL image from a gallery id or an uploaded data URL."""
    from PIL import Image

    if req.image_data:
        return gallery.decode_data_url(req.image_data, messages.INPAINT_SOURCE_MISSING)
    if req.image_id:
        path = gallery.file_path(req.image_id)
        if path is None:
            raise ValueError(messages.IMAGE_NOT_FOUND.format(image_id=req.image_id))
        return Image.open(path)
    raise ValueError(messages.INPAINT_SOURCE_MISSING)


def _run(job: _Job, req: InpaintRequest, image, mask, engine: UpscalerInfo) -> None:
    pub_key = f"inpaint:{job.job_id}"

    def on_progress(update: dict) -> None:
        with _lock:
            for key, value in update.items():
                setattr(job, key, value)
        live.publish(pub_key)

    base_seed = req.seed if req.seed is not None else random.randint(0, _SEED_MAX)
    sampler = req.sampler or samplers.DEFAULT_SAMPLER
    with _lock:
        job.batch_size = req.batch
    try:
        for i in range(req.batch):
            seed_i = (base_seed + i) % (_SEED_MAX + 1)
            with _lock:
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
            with _lock:
                job.phase = "finalizing"
            live.publish(pub_key)
            _save_result(job, req, result, engine, seed_i, sampler)
        with _lock:
            job.status = "done"
        live.publish(pub_key)
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI via job state
        with _lock:
            job.status = "error"
            job.error = messages.INPAINT_FAILED.format(detail=str(exc))
        live.publish(pub_key)
    finally:
        inpaint_engine.unload()  # free the inpaint pipe
        job_guard.release(job.job_id)


def _save_result(job, req, result, engine: UpscalerInfo, seed: int, sampler: str) -> None:
    meta = gallery.save(
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
            "seed": seed,
            "sampler": sampler,
        },
    )
    with _lock:
        if job.image_id is None:
            job.image_id = meta.id
        job.image_ids.append(meta.id)


@router.post("", response_model=InpaintStarted)
def start_inpaint(req: InpaintRequest) -> InpaintStarted:
    engine = upscalers.get(req.engine or upscalers.INPAINT_SLUG)
    if engine is None or engine.kind != "inpaint":
        raise HTTPException(404, messages.INPAINT_ENGINE_INVALID.format(slug=req.engine))
    if not downloader.is_downloaded(engine.slug):
        raise HTTPException(409, messages.INPAINT_MODEL_MISSING)

    try:
        image = _resolve_source(req)
        mask = gallery.decode_data_url(req.mask_data, messages.INPAINT_MASK_MISSING)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    with _lock:
        job = _Job(_new_job_id(), engine.name)
    busy = job_guard.acquire(job.job_id, "inpaint")
    if busy is not None:
        raise HTTPException(409, messages.JOB_BUSY.format(kind=busy))
    with _lock:
        _jobs[job.job_id] = job

    thread = threading.Thread(
        target=_run, args=(job, req, image, mask, engine), daemon=True
    )
    thread.start()
    return InpaintStarted(job_id=job.job_id)


@router.get("/{job_id}", response_model=BatchProgress)
def inpaint_progress(job_id: str) -> BatchProgress:
    with _lock:
        job = _jobs.get(job_id)
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
