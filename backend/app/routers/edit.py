"""Prompt-based image-editing jobs (FLUX.1 Kontext).

``POST /api/edit`` — edit a source (gallery id or uploaded data URL) from a
natural-language instruction via a selectable Kontext engine; saves result(s) to the
gallery at source resolution. Polled via ``GET /api/edit/{job_id}`` (BatchProgress
shape, shared live-stats UI). Uses the shared ``services.jobs`` store; publishes
``edit:{job_id}`` wakes to the WebSocket pusher.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import messages
from ..services import (
    downloader,
    edit as edit_svc,
    jobs,
    upscalers,
)
from ..services.upscalers import UpscalerInfo
from ..services.jobs import BatchProgress, LoraRef

router = APIRouter(prefix="/api/edit", tags=["edit"])


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

    def render(_i: int, seed_i: int):
        return edit_svc.edit_image(
            image, req.prompt, on_progress, engine,
            steps=req.steps,
            guidance=req.guidance,
            seed=seed_i,
            loras=[(lora.slug, lora.weight) for lora in req.loras],
        )

    def meta(seed_i: int, result) -> dict:
        return {
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
        }

    # unload frees the Kontext pipe when the batch ends (success or error).
    with jobs.job_run(_store, job, pub_key, messages.EDIT_FAILED, unload=edit_svc.unload):
        jobs.run_batch(
            _store, job, pub_key, batch=req.batch, seed=req.seed, render=render, meta=meta
        )


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

    job = jobs.start_job(_store, "edit", _run, req, image, engine, engine_name=engine.name)
    return EditStarted(job_id=job.job_id)


@router.get("/{job_id}", response_model=BatchProgress)
def edit_progress(job_id: str) -> BatchProgress:
    with _store.lock:
        job = _store.get(job_id)
        if job is None:
            raise HTTPException(404, messages.JOB_NOT_FOUND.format(job_id=job_id))
        return jobs.to_batch_progress(job)
