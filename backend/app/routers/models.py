"""Model catalog, HuggingFace browsing, download and progress endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .. import messages
from ..catalog import CATALOG, ModelInfo, get_model
from ..config import load_settings
from ..services import custom_models, downloader, fit, pipeline
from ..services.custom_models import resolve_model

router = APIRouter(prefix="/api/models", tags=["models"])


class CatalogEntry(ModelInfo):
    downloaded: bool
    status: str  # "idle" | "downloading" | "done" | "error"
    curated: bool
    fit: fit.FitInfo


class DownloadStarted(BaseModel):
    slug: str
    message: str


class AddModelRequest(BaseModel):
    repo_id: str


def _entry(model: ModelInfo, curated: bool) -> CatalogEntry:
    progress = downloader.get_progress(model.slug)
    return CatalogEntry(
        **model.model_dump(),
        downloaded=downloader.is_downloaded(model.slug),
        status=progress.status,
        curated=curated,
        fit=fit.assess(model),
    )


@router.get("", response_model=list[CatalogEntry])
def list_models() -> list[CatalogEntry]:
    """Curated models first, then user-added ones."""
    entries = [_entry(model, curated=True) for model in CATALOG]
    entries += [_entry(model, curated=False) for model in custom_models.load()]
    return entries


@router.get("/search", response_model=list[downloader.SearchResult])
def search_models(
    query: str = "",
    sort: str = "downloads",
    family: str = "",
    pipelines: list[str] = Query(default=["text-to-image"]),
    limit: int = 30,
) -> list[downloader.SearchResult]:
    token = load_settings().hf_token
    try:
        return downloader.search_repos(
            query, sort, limit, token, family or None, pipelines or None
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the user
        raise HTTPException(502, messages.SEARCH_FAILED.format(detail=exc)) from exc


@router.get("/resolve", response_model=downloader.ResolvedModel)
def resolve_repo(repo_id: str) -> downloader.ResolvedModel:
    if get_model(downloader.slug_for(repo_id)) is not None:
        raise HTTPException(409, messages.MODEL_ALREADY_IN_CATALOG.format(repo_id=repo_id))
    token = load_settings().hf_token
    try:
        return downloader.resolve_repo(repo_id, token)
    except Exception as exc:  # noqa: BLE001 - surfaced to the user
        raise HTTPException(
            400, messages.RESOLVE_FAILED.format(repo_id=repo_id, detail=exc)
        ) from exc


@router.post("", response_model=DownloadStarted)
def add_model(body: AddModelRequest) -> DownloadStarted:
    token = load_settings().hf_token
    if get_model(downloader.slug_for(body.repo_id)) is not None:
        raise HTTPException(
            409, messages.MODEL_ALREADY_IN_CATALOG.format(repo_id=body.repo_id)
        )
    try:
        resolved = downloader.resolve_repo(body.repo_id, token)
    except Exception as exc:  # noqa: BLE001 - surfaced to the user
        raise HTTPException(
            400, messages.RESOLVE_FAILED.format(repo_id=body.repo_id, detail=exc)
        ) from exc

    if not resolved.compatible:
        raise HTTPException(
            409, messages.MODEL_INCOMPATIBLE.format(repo_id=body.repo_id)
        )

    model = ModelInfo(**resolved.model_dump(exclude={"compatible", "fit"}))
    custom_models.add(model)
    try:
        downloader.start_download(model, token)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

    return DownloadStarted(
        slug=model.slug, message=messages.DOWNLOAD_STARTED.format(slug=model.slug)
    )


@router.post("/{slug}/download", response_model=DownloadStarted)
def download_model(slug: str) -> DownloadStarted:
    model = resolve_model(slug)
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
    if resolve_model(slug) is None:
        raise HTTPException(404, messages.MODEL_NOT_FOUND.format(slug=slug))
    return downloader.get_progress(slug)


@router.delete("/{slug}")
def delete_model(slug: str) -> dict[str, str]:
    if resolve_model(slug) is None:
        raise HTTPException(404, messages.MODEL_NOT_FOUND.format(slug=slug))
    try:
        downloader.delete_model(slug)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    pipeline.unload(slug)  # drop the cache if this model was loaded
    custom_models.remove(slug)  # no-op for curated models
    return {"slug": slug, "status": "deleted"}
