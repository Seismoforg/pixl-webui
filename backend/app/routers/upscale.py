"""AI image upscaling: engine catalog, downloads and upscale jobs.

Engines are listed with their on-disk state and downloaded on demand (reusing the
model download machinery). ``POST /api/upscale`` runs an upscale on a background
thread — source is either a stored gallery image or an uploaded data URL — and
saves the result to the gallery, polled via ``GET /api/upscale/{job_id}``.
"""
from __future__ import annotations

import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import live, messages
from ..services import (
    downloader,
    fit,
    gallery,
    job_guard,
    outpaint as outpaint_svc,
    upscale as upscale_svc,
    upscalers,
)
from ..services.upscalers import UpscalerInfo
from ..config import load_settings

router = APIRouter(prefix="/api/upscale", tags=["upscale"])


class UpscalerEntry(BaseModel):
    slug: str
    kind: str
    name: str
    description: str
    repo_id: str
    family: str  # "Upscaler" | "Outpaint" (derived from kind)
    scale: int
    approx_size_gb: float
    min_vram_gb: float  # recommended GPU VRAM — shown as a per-row badge
    prompt_capable: bool
    is_gguf: bool  # GGUF-quantized (FLUX Fill) — drives Flux-specific UI handling
    downloaded: bool
    status: str  # "idle" | "downloading" | "done" | "error"
    fit: fit.FitInfo  # GPU-fit verdict, like the model catalog entries


class DownloadStarted(BaseModel):
    slug: str
    message: str


def _engine_family(kind: str) -> str:
    if kind == "inpaint":
        return "Outpaint"
    if kind == "edit":
        return "Post Processing"
    return "Upscaler"


class UpscaleRequest(BaseModel):
    engine: str
    image_id: str | None = None   # source: an existing gallery image
    image_data: str | None = None  # source: an uploaded image as a data URL
    prompt: str = ""  # guides the diffusion upscaler (SD x4) toward detail
    # Auto-split large images into tiles and stitch the result (bounds VRAM,
    # speeds up inference). Off = single pass / capped input.
    tile: bool = True
    # Per-run SD x4 denoising steps; None → the persisted `sd_x4_steps` setting.
    sd_x4_steps: int | None = None


class UpscaleStarted(BaseModel):
    job_id: str


class UpscaleProgress(BaseModel):
    job_id: str
    status: str  # "running" | "done" | "error"
    phase: str  # "loading" | "upscaling" | "finalizing"
    current_tile: int
    total_tiles: int
    current_step: int
    total_steps: int
    its: float | None  # iterations/second (SD x4 steps); None until measurable
    elapsed: float  # seconds since the job started
    engine_name: str
    image_id: str | None = None
    error: str | None = None


class BatchProgress(UpscaleProgress):
    """A batch job's progress = the shared upscale shape plus batch fields (a superset,
    so the frontend's upscale-based live-stats UI keeps working unchanged). Shared by
    the reframe, inpaint and edit jobs, which each generate a batch of variants."""

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
        self.error: str | None = None

    def elapsed(self) -> float:
        return time.perf_counter() - self.started_at


_jobs: dict[str, _Job] = {}
_lock = threading.Lock()
_counter = 0


def _new_job_id() -> str:
    global _counter
    _counter += 1
    return f"ups-{_counter}"


def _resolve_source(req: UpscaleRequest):
    """Load the source PIL image from a gallery id or an uploaded data URL."""
    from PIL import Image

    if req.image_data:
        return gallery.decode_data_url(req.image_data, messages.UPSCALE_SOURCE_MISSING)
    if req.image_id:
        path = gallery.file_path(req.image_id)
        if path is None:
            raise ValueError(messages.IMAGE_NOT_FOUND.format(image_id=req.image_id))
        return Image.open(path)
    raise ValueError(messages.UPSCALE_SOURCE_MISSING)


def _run(
    job: _Job,
    engine: upscalers.UpscalerInfo,
    image,
    prompt: str,
    tile: bool,
    sd_x4_steps: int | None,
) -> None:
    # Wakes the WebSocket pusher after each state change (no-op with no subscriber).
    pub_key = f"upscale:{job.job_id}"

    def on_progress(update: dict) -> None:
        with _lock:
            for key, value in update.items():
                setattr(job, key, value)
        live.publish(pub_key)

    try:
        result = upscale_svc.upscale(
            engine, image, prompt, tile, on_progress=on_progress, sd_x4_steps=sd_x4_steps
        )
        with _lock:
            job.phase = "finalizing"
        live.publish(pub_key)
        meta = gallery.save(
            result,
            {
                "model_slug": engine.slug,
                "model_name": engine.name,
                "prompt": prompt or f"Upscaled · {engine.name}",
                "negative_prompt": None,
                "steps": 0,
                "guidance_scale": 0.0,
                "width": result.width,
                "height": result.height,
                "seed": 0,
                "sampler": "upscale",
            },
        )
        with _lock:
            job.image_id = meta.id
            job.status = "done"
        live.publish(pub_key)
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI via job state
        with _lock:
            job.status = "error"
            job.error = messages.UPSCALE_FAILED.format(detail=str(exc))
        live.publish(pub_key)
    finally:
        job_guard.release(job.job_id)


@router.get("/engines", response_model=list[UpscalerEntry])
def list_engines() -> list[UpscalerEntry]:
    entries: list[UpscalerEntry] = []
    for u in upscalers.all_engines():
        progress = downloader.get_progress(u.slug)
        entries.append(
            UpscalerEntry(
                **u.model_dump(exclude={
                    "filename", "variant", "use_safetensors",
                    "gguf_repo_id", "gguf_filename", "defaults",
                }),
                is_gguf=u.is_gguf,
                family=_engine_family(u.kind),
                downloaded=downloader.is_downloaded(u.slug),
                status=progress.status,
                fit=fit.assess(upscale_svc.to_model_info(u)),
            )
        )
    return entries


# --- Engine-catalog editing (Settings) ----------------------------------------
# Registered before the `/engines/{slug}` routes so "catalog" is never a slug.

@router.get("/engines/catalog", response_model=list[UpscalerInfo])
def read_engine_catalog() -> list[UpscalerInfo]:
    """The raw, editable curated engine catalog (no per-engine runtime state)."""
    return upscalers.load_catalog()


@router.put("/engines/catalog", response_model=list[UpscalerInfo])
def write_engine_catalog(engines: list[UpscalerInfo]) -> list[UpscalerInfo]:
    slugs = [e.slug for e in engines]
    duplicate = next((s for s in slugs if slugs.count(s) > 1), None)
    if duplicate is not None:
        raise HTTPException(400, messages.CATALOG_DUPLICATE_SLUG.format(slug=duplicate))
    return upscalers.save_catalog(engines)


@router.post("/engines/catalog/reset", response_model=list[UpscalerInfo])
def reset_engine_catalog() -> list[UpscalerInfo]:
    return upscalers.reset_catalog()


@router.delete("/engines/{slug}")
def delete_engine(slug: str) -> dict[str, str]:
    if upscalers.get(slug) is None:
        raise HTTPException(404, messages.UPSCALER_NOT_FOUND.format(slug=slug))
    try:
        downloader.delete_model(slug)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    upscale_svc.unload(keep_slug=None)  # drop cached engines if this one was loaded
    outpaint_svc.unload()
    return {"slug": slug, "status": "deleted"}


@router.post("/engines/{slug}/download", response_model=DownloadStarted)
def download_engine(slug: str) -> DownloadStarted:
    engine = upscalers.get(slug)
    if engine is None:
        raise HTTPException(404, messages.UPSCALER_NOT_FOUND.format(slug=slug))
    token = load_settings().hf_token
    try:
        upscale_svc.start_engine_download(engine, token)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return DownloadStarted(slug=slug, message=messages.DOWNLOAD_STARTED.format(slug=slug))


@router.get("/engines/{slug}/progress", response_model=downloader.DownloadProgress)
def engine_progress(slug: str) -> downloader.DownloadProgress:
    if upscalers.get(slug) is None:
        raise HTTPException(404, messages.UPSCALER_NOT_FOUND.format(slug=slug))
    return downloader.get_progress(slug)


@router.post("", response_model=UpscaleStarted)
def start_upscale(req: UpscaleRequest) -> UpscaleStarted:
    engine = upscalers.get(req.engine)
    if engine is None:
        raise HTTPException(404, messages.UPSCALER_NOT_FOUND.format(slug=req.engine))
    if not downloader.is_downloaded(engine.slug):
        raise HTTPException(409, messages.MODEL_NOT_DOWNLOADED.format(slug=engine.slug))

    try:
        image = _resolve_source(req)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    with _lock:
        job = _Job(_new_job_id(), engine.name)
    busy = job_guard.acquire(job.job_id, "upscale")
    if busy is not None:
        raise HTTPException(409, messages.JOB_BUSY.format(kind=busy))
    with _lock:
        _jobs[job.job_id] = job

    thread = threading.Thread(
        target=_run,
        args=(job, engine, image, req.prompt, req.tile, req.sd_x4_steps),
        daemon=True,
    )
    thread.start()
    return UpscaleStarted(job_id=job.job_id)


@router.get("/{job_id}", response_model=UpscaleProgress)
def upscale_progress(job_id: str) -> UpscaleProgress:
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
