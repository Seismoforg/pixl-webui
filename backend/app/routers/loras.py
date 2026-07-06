"""LoRA adapters: catalog, downloads and deletion.

LoRAs are listed with their on-disk state and downloaded on demand (a single
``.safetensors`` file per entry, reusing the model download machinery). They are
applied at generation time — see ``services/pipeline.py`` and ``routers/generate.py``.
The curated list is JSON-backed and editable in Settings, mirroring the model and
engine catalogs.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import messages
from ..config import load_settings
from ..services import downloader, loras
from ..services.loras import LoraInfo

router = APIRouter(prefix="/api/loras", tags=["loras"])


class LoraEntry(LoraInfo):
    """A catalog LoRA plus its on-disk state (the /api/loras list shape)."""

    downloaded: bool
    status: str  # "idle" | "downloading" | "done" | "error"


class DownloadStarted(BaseModel):
    slug: str
    message: str


@router.get("", response_model=list[LoraEntry])
def list_loras() -> list[LoraEntry]:
    entries: list[LoraEntry] = []
    for lora in loras.all_loras():
        progress = downloader.get_progress(lora.slug)
        entries.append(
            LoraEntry(
                **lora.model_dump(),
                downloaded=downloader.is_downloaded(lora.slug),
                status=progress.status,
            )
        )
    return entries


# --- Catalog editing (Settings) ------------------------------------------------
# Registered before the `/{slug}` routes so "catalog" is never treated as a slug.

@router.get("/catalog", response_model=list[LoraInfo])
def read_catalog() -> list[LoraInfo]:
    return loras.load_catalog()


@router.put("/catalog", response_model=list[LoraInfo])
def write_catalog(entries: list[LoraInfo]) -> list[LoraInfo]:
    slugs = [e.slug for e in entries]
    duplicate = next((s for s in slugs if slugs.count(s) > 1), None)
    if duplicate is not None:
        raise HTTPException(400, messages.CATALOG_DUPLICATE_SLUG.format(slug=duplicate))
    return loras.save_catalog(entries)


@router.post("/catalog/reset", response_model=list[LoraInfo])
def reset_catalog() -> list[LoraInfo]:
    return loras.reset_catalog()


@router.delete("/{slug}")
def delete_lora(slug: str) -> dict[str, str]:
    if loras.get(slug) is None:
        raise HTTPException(404, messages.LORA_NOT_FOUND.format(slug=slug))
    try:
        downloader.delete_model(slug)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"slug": slug, "status": "deleted"}


@router.post("/{slug}/download", response_model=DownloadStarted)
def download_lora(slug: str) -> DownloadStarted:
    lora = loras.get(slug)
    if lora is None:
        raise HTTPException(404, messages.LORA_NOT_FOUND.format(slug=slug))
    token = load_settings().hf_token
    try:
        downloader.start_file_download(lora.slug, lora.repo_id, lora.filename, token)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return DownloadStarted(slug=slug, message=messages.DOWNLOAD_STARTED.format(slug=slug))


@router.get("/{slug}/progress", response_model=downloader.DownloadProgress)
def lora_progress(slug: str) -> downloader.DownloadProgress:
    if loras.get(slug) is None:
        raise HTTPException(404, messages.LORA_NOT_FOUND.format(slug=slug))
    return downloader.get_progress(slug)
