"""Prompt-based image-editing jobs (FLUX.1 Kontext).

``POST /api/edit`` — edit a source (gallery id or uploaded data URL) from a
natural-language instruction via a selectable Kontext engine; saves result(s) to the
gallery at source resolution. Polled via ``GET /api/edit/{job_id}`` (BatchProgress
shape, shared live-stats UI). Uses the shared ``services.jobs`` store; publishes
``edit:{job_id}`` wakes to the WebSocket pusher.
"""
from __future__ import annotations

import random
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import live, messages
from ..services import (
    downloader,
    edit as edit_svc,
    job_guard,
    jobs,
    upscalers,
)
from ..services.upscalers import UpscalerInfo
from ..services.jobs import BatchProgress

router = APIRouter(prefix="/api/edit", tags=["edit"])


class LoraRef(BaseModel):
    slug: str
    weight: float = Field(default=1.0, ge=0.0, le=2.0)


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
    # LoRA adapters to blend onto the edit pipe (each family-matched + downloaded).
    loras: list[LoraRef] = []


class EditStarted(BaseModel):
    job_id: str


_store: jobs.JobStore[jobs.JobState] = jobs.JobStore("edit")


def _run(job: jobs.JobState, req: EditRequest, image, engine: UpscalerInfo) -> None:
    pub_key = f"edit:{job.job_id}"
    on_progress = jobs.make_on_progress(job, _store.lock, pub_key)

    base_seed = req.seed if req.seed is not None else random.randint(0, jobs.SEED_MAX)
    with _store.lock:
        job.batch_size = req.batch
    try:
        for i in range(req.batch):
            seed_i = (base_seed + i) % (jobs.SEED_MAX + 1)
            with _store.lock:
                job.batch_index = i + 1
                job.start_image()
            result = edit_svc.edit_image(
                image, req.prompt, on_progress, engine,
                steps=req.steps,
                guidance=req.guidance,
                seed=seed_i,
                loras=[(lora.slug, lora.weight) for lora in req.loras],
            )
            with _store.lock:
                job.phase = "finalizing"
                job.mark_decode()
            live.publish(pub_key)
            jobs.save_result(
                _store,
                job,
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
                    "seed": seed_i,
                    "sampler": "edit",
                },
            )
        with _store.lock:
            job.status = "done"
        live.publish(pub_key)
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI via job state
        with _store.lock:
            job.status = "error"
            job.error = messages.EDIT_FAILED.format(detail=str(exc))
        live.publish(pub_key)
    finally:
        edit_svc.unload()  # free the Kontext pipe
        job_guard.release(job.job_id)


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
        image = jobs.resolve_source(req, messages.EDIT_SOURCE_MISSING)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    with _store.lock:
        job = jobs.JobState(_store.new_id(), engine.name)
    busy = job_guard.acquire(job.job_id, "edit")
    if busy is not None:
        raise HTTPException(409, messages.JOB_BUSY.format(kind=busy))
    with _store.lock:
        _store.add(job)

    thread = threading.Thread(target=_run, args=(job, req, image, engine), daemon=True)
    thread.start()
    return EditStarted(job_id=job.job_id)


@router.get("/{job_id}", response_model=BatchProgress)
def edit_progress(job_id: str) -> BatchProgress:
    with _store.lock:
        job = _store.get(job_id)
        if job is None:
            raise HTTPException(404, messages.JOB_NOT_FOUND.format(job_id=job_id))
        return jobs.to_batch_progress(job)
