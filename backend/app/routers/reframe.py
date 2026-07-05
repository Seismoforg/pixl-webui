"""Aspect-ratio reframing jobs (no upscaling).

``POST /api/reframe`` reframes a source image (a stored gallery image or an
uploaded data URL) to a target aspect ratio using a non-AI strategy
(cover/contain/edge) or an AI outpaint pass, and saves the result to the gallery
at the source resolution — it never runs an upscaler. Polled via
``GET /api/reframe/{job_id}``; the progress payload reuses the upscale job's
:class:`UpscaleProgress` shape so the frontend can share the live-stats UI.

Mirrors the upscale router's small per-job store + background thread (the same
pattern as generation/upscale) and publishes ``reframe:{job_id}`` wakes to the
WebSocket pusher.
"""
from __future__ import annotations

import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import live, messages
from ..services import (
    downloader,
    gallery,
    outpaint as outpaint_svc,
    reframe as reframe_svc,
    upscalers,
)
from ..services.upscalers import UpscalerInfo
from .upscale import UpscaleProgress

router = APIRouter(prefix="/api/reframe", tags=["reframe"])


class ReframeRequest(BaseModel):
    image_id: str | None = None   # source: an existing gallery image
    image_data: str | None = None  # source: an uploaded image as a data URL
    # Target aspect ratio (e.g. "16:9"); "original"/invalid is rejected — reframing
    # always changes the ratio.
    target_ratio: str
    reframe: str = "cover"  # "cover" | "contain" | "edge" | "outpaint"
    outpaint_prompt: str = ""  # describes the scene generated in the outpainted area
    # Inpaint engine (slug) used for reframe=outpaint; None → the curated default.
    outpaint_engine: str | None = None


class ReframeStarted(BaseModel):
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
        self.error: str | None = None

    def elapsed(self) -> float:
        return time.perf_counter() - self.started_at


_jobs: dict[str, _Job] = {}
_lock = threading.Lock()
_counter = 0


def _new_job_id() -> str:
    global _counter
    _counter += 1
    return f"reframe-{_counter}"


def _resolve_source(req: ReframeRequest):
    """Load the source PIL image from a gallery id or an uploaded data URL."""
    from PIL import Image

    if req.image_data:
        return gallery.decode_data_url(req.image_data, messages.REFRAME_SOURCE_MISSING)
    if req.image_id:
        path = gallery.file_path(req.image_id)
        if path is None:
            raise ValueError(messages.IMAGE_NOT_FOUND.format(image_id=req.image_id))
        return Image.open(path)
    raise ValueError(messages.REFRAME_SOURCE_MISSING)


def _run(
    job: _Job,
    image,
    ratio: tuple[float, float],
    target_ratio: str,
    strategy: str,
    outpaint_prompt: str,
    outpaint_engine: UpscalerInfo | None,
) -> None:
    # Wakes the WebSocket pusher after each state change (no-op with no subscriber).
    pub_key = f"reframe:{job.job_id}"

    def on_progress(update: dict) -> None:
        with _lock:
            for key, value in update.items():
                setattr(job, key, value)
        live.publish(pub_key)

    try:
        if strategy == "outpaint" and outpaint_engine is not None:
            # Generate the new border in one coherent pass; the source is composited
            # back pixel-exact at full resolution. No upscaler runs afterwards.
            result = outpaint_svc.reframe_image(
                image, ratio, outpaint_prompt, on_progress, outpaint_engine
            )
            outpaint_svc.unload()  # free the inpaint pipe
            model_slug, model_name = outpaint_engine.slug, outpaint_engine.name
        else:
            # cover / contain / edge are cheap PIL ops — no engine, near-instant.
            result = reframe_svc.apply(image.convert("RGB"), ratio, strategy)
            model_slug, model_name = "reframe", "Reframe"
        with _lock:
            job.phase = "finalizing"
        live.publish(pub_key)
        meta = gallery.save(
            result,
            {
                "model_slug": model_slug,
                "model_name": model_name,
                "prompt": f"Reframed · {target_ratio} · {strategy}",
                "negative_prompt": None,
                "steps": 0,
                "guidance_scale": 0.0,
                "width": result.width,
                "height": result.height,
                "seed": 0,
                "sampler": "reframe",
            },
        )
        with _lock:
            job.image_id = meta.id
            job.status = "done"
        live.publish(pub_key)
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI via job state
        with _lock:
            job.status = "error"
            job.error = messages.REFRAME_FAILED.format(detail=str(exc))
        live.publish(pub_key)


@router.post("", response_model=ReframeStarted)
def start_reframe(req: ReframeRequest) -> ReframeStarted:
    ratio = reframe_svc.parse_ratio(req.target_ratio)
    if ratio is None:
        raise HTTPException(400, messages.REFRAME_RATIO_REQUIRED)

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
        image = _resolve_source(req)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    with _lock:
        if any(j.status == "running" for j in _jobs.values()):
            raise HTTPException(409, messages.REFRAME_ALREADY_RUNNING)
        engine_name = outpaint_engine.name if outpaint_engine else "Reframe"
        job = _Job(_new_job_id(), engine_name)
        _jobs[job.job_id] = job

    thread = threading.Thread(
        target=_run,
        args=(
            job, image, ratio, req.target_ratio, req.reframe,
            req.outpaint_prompt, outpaint_engine,
        ),
        daemon=True,
    )
    thread.start()
    return ReframeStarted(job_id=job.job_id)


@router.get("/{job_id}", response_model=UpscaleProgress)
def reframe_progress(job_id: str) -> UpscaleProgress:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(404, messages.JOB_NOT_FOUND.format(job_id=job_id))
        return UpscaleProgress(
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
        )
