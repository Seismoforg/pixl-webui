"""Prompt-based image-editing jobs (FLUX.1 Kontext).

``POST /api/edit`` edits a source image (a stored gallery image or an uploaded data
URL) from a natural-language instruction using a selectable FLUX Kontext engine, and
saves the result(s) to the gallery at the source resolution. Polled via
``GET /api/edit/{job_id}``; the progress payload reuses the reframe/upscale job shape
so the frontend shares the live-stats UI.

Mirrors the inpaint router's per-job store + background thread and publishes
``edit:{job_id}`` wakes to the WebSocket pusher.
"""
from __future__ import annotations

import random
import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import live, messages
from ..services import (
    downloader,
    edit as edit_svc,
    gallery,
    upscalers,
)
from ..services.upscalers import UpscalerInfo
from .upscale import UpscaleProgress

router = APIRouter(prefix="/api/edit", tags=["edit"])

_SEED_MAX = 2**32 - 1


class EditRequest(BaseModel):
    image_id: str | None = None   # source: an existing gallery image
    image_data: str | None = None  # source: an uploaded image as a data URL
    # Edit engine (slug); None → the curated default FLUX Kontext engine.
    engine: str | None = None
    prompt: str = ""  # the natural-language edit instruction
    # Generation parameters: denoising step count, guidance scale, RNG seed
    # (None → random), and how many variants to generate (incrementing seeds).
    steps: int = Field(default=edit_svc.DEFAULT_STEPS, ge=1, le=150)
    guidance: float = Field(default=edit_svc.DEFAULT_GUIDANCE, ge=0.0, le=30.0)
    seed: int | None = None
    batch: int = Field(default=1, ge=1, le=8)


class EditStarted(BaseModel):
    job_id: str


class EditProgress(UpscaleProgress):
    """Edit job progress = the shared upscale shape plus batch fields (a superset,
    so the frontend's upscale-based live-stats UI keeps working unchanged)."""

    batch_index: int = 0
    batch_size: int = 1
    image_ids: list[str] = []


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
    return f"edit-{_counter}"


def _resolve_source(req: EditRequest):
    """Load the source PIL image from a gallery id or an uploaded data URL."""
    from PIL import Image

    if req.image_data:
        return gallery.decode_data_url(req.image_data, messages.EDIT_SOURCE_MISSING)
    if req.image_id:
        path = gallery.file_path(req.image_id)
        if path is None:
            raise ValueError(messages.IMAGE_NOT_FOUND.format(image_id=req.image_id))
        return Image.open(path)
    raise ValueError(messages.EDIT_SOURCE_MISSING)


def _run(job: _Job, req: EditRequest, image, engine: UpscalerInfo) -> None:
    pub_key = f"edit:{job.job_id}"

    def on_progress(update: dict) -> None:
        with _lock:
            for key, value in update.items():
                setattr(job, key, value)
        live.publish(pub_key)

    base_seed = req.seed if req.seed is not None else random.randint(0, _SEED_MAX)
    with _lock:
        job.batch_size = req.batch
    try:
        for i in range(req.batch):
            seed_i = (base_seed + i) % (_SEED_MAX + 1)
            with _lock:
                job.batch_index = i + 1
            result = edit_svc.edit_image(
                image, req.prompt, on_progress, engine,
                steps=req.steps,
                guidance=req.guidance,
                seed=seed_i,
            )
            with _lock:
                job.phase = "finalizing"
            live.publish(pub_key)
            _save_result(job, req, result, engine, seed_i)
        with _lock:
            job.status = "done"
        live.publish(pub_key)
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI via job state
        with _lock:
            job.status = "error"
            job.error = messages.EDIT_FAILED.format(detail=str(exc))
        live.publish(pub_key)
    finally:
        edit_svc.unload()  # free the Kontext pipe


def _save_result(job, req, result, engine: UpscalerInfo, seed: int) -> None:
    meta = gallery.save(
        result,
        {
            "model_slug": engine.slug,
            "model_name": engine.name,
            "prompt": req.prompt,
            "negative_prompt": None,
            "steps": req.steps,
            "guidance_scale": req.guidance,
            "width": result.width,
            "height": result.height,
            "seed": seed,
            "sampler": "edit",
        },
    )
    with _lock:
        if job.image_id is None:
            job.image_id = meta.id
        job.image_ids.append(meta.id)


@router.post("", response_model=EditStarted)
def start_edit(req: EditRequest) -> EditStarted:
    if not req.prompt.strip():
        raise HTTPException(400, messages.EDIT_PROMPT_REQUIRED)
    engine = upscalers.get(req.engine or upscalers.EDIT_SLUG)
    if engine is None or engine.kind != "edit":
        raise HTTPException(404, messages.EDIT_ENGINE_INVALID.format(slug=req.engine))
    if not downloader.is_downloaded(engine.slug):
        raise HTTPException(409, messages.EDIT_MODEL_MISSING)

    try:
        image = _resolve_source(req)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    with _lock:
        if any(j.status == "running" for j in _jobs.values()):
            raise HTTPException(409, messages.EDIT_ALREADY_RUNNING)
        job = _Job(_new_job_id(), engine.name)
        _jobs[job.job_id] = job

    thread = threading.Thread(target=_run, args=(job, req, image, engine), daemon=True)
    thread.start()
    return EditStarted(job_id=job.job_id)


@router.get("/{job_id}", response_model=EditProgress)
def edit_progress(job_id: str) -> EditProgress:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(404, messages.JOB_NOT_FOUND.format(job_id=job_id))
        return EditProgress(
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
