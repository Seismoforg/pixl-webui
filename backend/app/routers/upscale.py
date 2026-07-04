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
    custom_upscalers,
    downloader,
    gallery,
    hf_browse,
    outpaint as outpaint_svc,
    reframe as reframe_svc,
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
    prompt_capable: bool
    curated: bool
    downloaded: bool
    status: str  # "idle" | "downloading" | "done" | "error"


class DownloadStarted(BaseModel):
    slug: str
    message: str


class AddEngineRequest(BaseModel):
    repo_id: str
    kind: str  # "realesrgan" | "sd_x4" | "inpaint"
    filename: str | None = None  # required for "realesrgan"


_ENGINE_KINDS = ("realesrgan", "sd_x4", "inpaint")


def _engine_family(kind: str) -> str:
    return "Outpaint" if kind == "inpaint" else "Upscaler"


class UpscaleRequest(BaseModel):
    engine: str
    image_id: str | None = None   # source: an existing gallery image
    image_data: str | None = None  # source: an uploaded image as a data URL
    prompt: str = ""  # guides the diffusion upscaler (SD x4) toward detail
    outpaint_prompt: str = ""  # describes the scene generated in the outpainted area
    # Auto-split large images into tiles and stitch the result (bounds VRAM,
    # speeds up inference). Off = single pass / capped input. Also drives tiled vs.
    # single-pass outpaint.
    tile: bool = True
    # Reframe to a target aspect ratio (e.g. "16:9"); "original" = keep the source
    # ratio. `reframe` chooses how the extra area is handled.
    target_ratio: str = "original"
    reframe: str = "cover"  # "cover" | "contain" | "edge" | "outpaint"
    # Inpaint engine (slug) used for reframe=outpaint; None → the curated default.
    outpaint_engine: str | None = None


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
    outpaint_prompt: str,
    tile: bool,
    target_ratio: str,
    reframe: str,
    outpaint_engine: UpscalerInfo | None,
) -> None:
    # Wakes the WebSocket pusher after each state change (no-op with no subscriber).
    pub_key = f"upscale:{job.job_id}"

    def on_progress(update: dict) -> None:
        with _lock:
            for key, value in update.items():
                setattr(job, key, value)
        live.publish(pub_key)

    try:
        ratio = reframe_svc.parse_ratio(target_ratio)
        if ratio and reframe == "outpaint" and outpaint_engine is not None:
            # Outpaint the whole canvas in one coherent pass, then upscale to full
            # resolution (the `tile` flag controls that upscale step).
            reframed = outpaint_svc.reframe_image(
                image, ratio, outpaint_prompt, on_progress, outpaint_engine
            )
            outpaint_svc.unload()  # free the inpaint pipe before upscaling
            result = upscale_svc.upscale(engine, reframed, prompt, tile, on_progress=on_progress)
        else:
            upscaled = upscale_svc.upscale(engine, image, prompt, tile, on_progress=on_progress)
            # cover / contain / edge are cheap PIL ops; ratio None → unchanged.
            result = reframe_svc.apply(upscaled, ratio, reframe)
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


@router.get("/engines", response_model=list[UpscalerEntry])
def list_engines() -> list[UpscalerEntry]:
    entries: list[UpscalerEntry] = []
    for u in upscalers.all_engines():
        progress = downloader.get_progress(u.slug)
        entries.append(
            UpscalerEntry(
                **u.model_dump(exclude={"filename", "variant", "use_safetensors"}),
                family=_engine_family(u.kind),
                curated=upscalers.is_curated(u.slug),
                downloaded=downloader.is_downloaded(u.slug),
                status=progress.status,
            )
        )
    return entries


@router.get("/engines/resolve", response_model=hf_browse.EngineResolve)
def resolve_engine(repo_id: str, kind: str) -> hf_browse.EngineResolve:
    if kind not in _ENGINE_KINDS:
        raise HTTPException(400, messages.ENGINE_KIND_INVALID.format(kind=kind))
    token = load_settings().hf_token
    try:
        return hf_browse.resolve_engine(repo_id, kind, token)
    except Exception as exc:  # noqa: BLE001 - surfaced to the user
        raise HTTPException(
            400, messages.RESOLVE_FAILED.format(repo_id=repo_id, detail=exc)
        ) from exc


@router.post("/engines", response_model=DownloadStarted)
def add_engine(body: AddEngineRequest) -> DownloadStarted:
    if body.kind not in _ENGINE_KINDS:
        raise HTTPException(400, messages.ENGINE_KIND_INVALID.format(kind=body.kind))
    if body.kind == "realesrgan" and not body.filename:
        raise HTTPException(400, messages.ENGINE_FILENAME_REQUIRED)

    token = load_settings().hf_token
    try:
        resolved = hf_browse.resolve_engine(body.repo_id, body.kind, token)
    except Exception as exc:  # noqa: BLE001 - surfaced to the user
        raise HTTPException(
            400, messages.RESOLVE_FAILED.format(repo_id=body.repo_id, detail=exc)
        ) from exc
    if not resolved.compatible:
        raise HTTPException(
            409, messages.ENGINE_INCOMPATIBLE.format(repo_id=body.repo_id, kind=body.kind)
        )

    role = "outpaint" if body.kind == "inpaint" else "upscaler"
    slug = f"{role}--{hf_browse.slug_for(body.repo_id)}"
    if upscalers.get(slug) is not None:
        raise HTTPException(409, messages.ENGINE_ALREADY_ADDED.format(repo_id=body.repo_id))

    if body.kind == "realesrgan":
        size = next(
            (w.approx_size_gb for w in resolved.weights if w.filename == body.filename), 0.0
        )
        engine = UpscalerInfo(
            slug=slug, kind=body.kind, name=body.repo_id.split("/")[-1],
            description=body.repo_id, repo_id=body.repo_id, filename=body.filename,
            scale=4, approx_size_gb=size, prompt_capable=False,
        )
    else:
        engine = UpscalerInfo(
            slug=slug, kind=body.kind, name=body.repo_id.split("/")[-1],
            description=body.repo_id, repo_id=body.repo_id, filename=None,
            scale=4 if body.kind == "sd_x4" else 1,
            approx_size_gb=resolved.approx_size_gb,
            prompt_capable=True, variant=resolved.variant,
            use_safetensors=resolved.use_safetensors,
        )

    custom_upscalers.add(engine)
    try:
        upscale_svc.start_engine_download(engine, token)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return DownloadStarted(slug=slug, message=messages.DOWNLOAD_STARTED.format(slug=slug))


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
    custom_upscalers.remove(slug)  # no-op for curated engines
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

    # Outpaint needs the selected inpaint model on disk.
    outpaint_engine: UpscalerInfo | None = None
    if req.reframe == "outpaint" and reframe_svc.parse_ratio(req.target_ratio):
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
            raise HTTPException(409, messages.UPSCALE_ALREADY_RUNNING)
        job = _Job(_new_job_id(), engine.name)
        _jobs[job.job_id] = job

    thread = threading.Thread(
        target=_run,
        args=(
            job, engine, image, req.prompt, req.outpaint_prompt, req.tile,
            req.target_ratio, req.reframe, outpaint_engine,
        ),
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
