"""Model catalog, download and progress endpoints.

The curated catalog is JSON-backed (see :mod:`app.catalog`) and editable via the
``/api/models/catalog`` CRUD endpoints — there is no HuggingFace browser; every
model comes from the curated catalog.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import messages
from .. import catalog
from ..catalog import ModelInfo, get_model
from ..config import load_settings
from ..services import downloader, fit, pipeline

router = APIRouter(prefix="/api/models", tags=["models"])


class CatalogEntry(ModelInfo):
    downloaded: bool
    status: str  # "idle" | "downloading" | "done" | "error"
    fit: fit.FitInfo


class DownloadStarted(BaseModel):
    slug: str
    message: str


def _entry(model: ModelInfo) -> CatalogEntry:
    progress = downloader.get_progress(model.slug)
    return CatalogEntry(
        **model.model_dump(),
        downloaded=downloader.is_downloaded(model.slug),
        status=progress.status,
        fit=fit.assess(model),
    )


@router.get("", response_model=list[CatalogEntry])
def list_models() -> list[CatalogEntry]:
    """The curated catalog, each entry with its on-disk state + GPU-fit verdict."""
    return [_entry(model) for model in catalog.load_catalog()]


# --- Catalog editing (Settings) -----------------------------------------------
# Registered before the `/{slug}` routes so "catalog" is never read as a slug.

@router.get("/catalog", response_model=list[ModelInfo])
def read_catalog() -> list[ModelInfo]:
    """The raw, editable curated catalog (no per-model runtime state)."""
    return catalog.load_catalog()


@router.put("/catalog", response_model=list[ModelInfo])
def write_catalog(models: list[ModelInfo]) -> list[ModelInfo]:
    slugs = [m.slug for m in models]
    duplicate = next((s for s in slugs if slugs.count(s) > 1), None)
    if duplicate is not None:
        raise HTTPException(400, messages.CATALOG_DUPLICATE_SLUG.format(slug=duplicate))
    return catalog.save_catalog(models)


@router.post("/catalog/reset", response_model=list[ModelInfo])
def reset_catalog() -> list[ModelInfo]:
    return catalog.reset_catalog()


@router.post("/{slug}/download", response_model=DownloadStarted)
def download_model(slug: str) -> DownloadStarted:
    model = get_model(slug)
    if model is None:
        raise HTTPException(404, messages.MODEL_NOT_FOUND.format(slug=slug))

    token = load_settings().hf_token
    try:
        downloader.start_download(model, token)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

    return DownloadStarted(slug=slug, message=messages.DOWNLOAD_STARTED.format(slug=slug))


@router.get("/{slug}/progress", response_model=downloader.DownloadProgress)
def download_progress(slug: str) -> downloader.DownloadProgress:
    if get_model(slug) is None:
        raise HTTPException(404, messages.MODEL_NOT_FOUND.format(slug=slug))
    return downloader.get_progress(slug)


@router.delete("/{slug}")
def delete_model(slug: str) -> dict[str, str]:
    if get_model(slug) is None:
        raise HTTPException(404, messages.MODEL_NOT_FOUND.format(slug=slug))
    try:
        downloader.delete_model(slug)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    pipeline.unload(slug)  # drop the cache if this model was loaded
    return {"slug": slug, "status": "deleted"}
