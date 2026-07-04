"""HuggingFace browsing: search + resolve arbitrary diffusers repos.

Split out of ``downloader.py`` (which keeps the download orchestration + progress
concern). This module inspects arbitrary HuggingFace repos so the UI can browse
and add custom generation models and custom upscale/outpaint engines: search for
loadable diffusers repos, resolve a repo into catalog shape (size/variant/fit),
and resolve an upscale/outpaint engine repo. It reuses ``resolve_download_files``
from ``downloader`` for the exact per-component file selection (one-way import).
"""
from __future__ import annotations

import fnmatch
import re

from pydantic import BaseModel

from ..catalog import GenerationDefaults, ModelInfo
from .downloader import resolve_download_files
from .fit import FitInfo, assess


class SearchResult(BaseModel):
    repo_id: str
    likes: int
    downloads: int
    gated: bool
    family: str
    pipeline_tag: str | None = None
    last_modified: str | None = None


class ResolvedModel(ModelInfo):
    """A repo resolved into catalog shape, plus load/fit assessment."""

    compatible: bool  # diffusers-format (has model_index.json) → loadable
    fit: FitInfo


# Sort keys accepted from the UI, mapped to huggingface_hub property names.
_SORT_KEYS = {"downloads": "downloads", "likes": "likes", "trending": "trending_score"}

# When a family filter is chosen, bias the HuggingFace search toward it. Results
# are still post-filtered by the detected family, so this only improves recall.
_FAMILY_SEARCH_HINT = {
    "SD 1.5": "stable diffusion 1.5",
    "SDXL": "sdxl",
    "FLUX": "flux",
    "SD 3.x": "stable diffusion 3",
}

# Family-specific generation defaults for resolved repos (best-effort).
_FAMILY_DEFAULTS = {
    "SD 1.5": GenerationDefaults(steps=30, guidance_scale=7.5, width=512, height=512),
    "SDXL": GenerationDefaults(steps=30, guidance_scale=7.0, width=1024, height=1024),
    "FLUX": GenerationDefaults(steps=20, guidance_scale=3.5, width=1024, height=1024),
    "SD 3.x": GenerationDefaults(steps=28, guidance_scale=4.5, width=1024, height=1024),
}
_GENERIC_DEFAULTS = GenerationDefaults(steps=30, guidance_scale=7.0, width=768, height=768)


def slug_for(repo_id: str) -> str:
    """Filesystem-safe, catalog-unique slug derived from a repo id."""
    slug = repo_id.lower().replace("/", "--")
    return re.sub(r"[^a-z0-9._-]", "-", slug)


def estimate_min_vram_gb(size_gb: float) -> float:
    """Heuristic VRAM estimate from download size.

    HuggingFace exposes no VRAM figure. Weights in fp16 dominate memory; add ~35%
    headroom for activations and the text/VAE stages, with a small floor. This is
    an estimate and is surfaced as such in the UI.
    """
    return round(max(3.0, size_gb * 1.35), 1)


def _detect_family(repo_id: str, tags: list[str]) -> str:
    hay = " ".join([repo_id, *tags]).lower()
    if "flux" in hay:
        return "FLUX"
    if "xl" in hay or "sdxl" in hay:
        return "SDXL"
    if "stable-diffusion-3" in hay or "sd3" in hay or "sd-3" in hay or "3.5" in hay:
        return "SD 3.x"
    if "stable-diffusion-v1" in hay or "sd1" in hay or "v1-5" in hay or "1.5" in hay:
        return "SD 1.5"
    return "Diffusers"


def _is_compatible(names: list[str]) -> bool:
    """True if the file list is a loadable diffusers repo shipping safetensors.

    Requires ``model_index.json`` (diffusers layout) plus subfolder-level
    ``.safetensors`` weights — the browser only surfaces models that have all the
    files needed to load, in safetensors format.
    """
    has_index = "model_index.json" in names
    has_safetensors = any(fnmatch.fnmatch(n, "*/*.safetensors") for n in names)
    return has_index and has_safetensors


def search_repos(
    query: str,
    sort: str,
    limit: int,
    token: str | None,
    family: str | None = None,
    pipelines: list[str] | None = None,
) -> list[SearchResult]:
    """Search HuggingFace for loadable diffusers models.

    Only models that are loadable *and* ship safetensors are returned; when
    ``family`` is set, results are limited to that model family. ``pipelines`` is
    the list of ``pipeline_tag``s to search (default ``["text-to-image"]``): each
    tag is queried and the results merged (deduplicated by repo id) up to
    ``limit``. A larger candidate pool is fetched per tag (with file lists + tags
    in one call via ``expand``) and then filtered.
    """
    from huggingface_hub import HfApi

    tags = pipelines or ["text-to-image"]
    search = query or ""
    if family and family in _FAMILY_SEARCH_HINT:
        search = f"{search} {_FAMILY_SEARCH_HINT[family]}".strip()

    api = HfApi()
    pool = max(1, min(limit * 3, 100))
    results: list[SearchResult] = []
    seen: set[str] = set()

    for tag in tags:
        if len(results) >= limit:
            break
        models = api.list_models(
            search=search or None,
            pipeline_tag=tag,
            filter="diffusers",  # library tag; `library=` kwarg was removed in hub 1.x
            sort=_SORT_KEYS.get(sort, "downloads"),  # descending by default
            limit=pool,
            # Fetch the file list + tags with the search so compatibility, family
            # and pipeline can be decided without a per-repo round trip.
            expand=["siblings", "gated", "downloads", "likes", "tags", "pipeline_tag"],
            token=token,
        )
        for m in models:
            if m.id in seen:
                continue
            names = [s.rfilename for s in (getattr(m, "siblings", None) or [])]
            if not _is_compatible(names):
                continue
            fam = _detect_family(m.id, list(getattr(m, "tags", None) or []))
            if family and fam != family:
                continue
            seen.add(m.id)
            results.append(
                SearchResult(
                    repo_id=m.id,
                    likes=getattr(m, "likes", 0) or 0,
                    downloads=getattr(m, "downloads", 0) or 0,
                    gated=bool(getattr(m, "gated", False)),
                    family=fam,
                    pipeline_tag=getattr(m, "pipeline_tag", None) or tag,
                )
            )
            if len(results) >= limit:
                break
    return results


def resolve_repo(repo_id: str, token: str | None) -> ResolvedModel:
    """Inspect a repo: download size, variant, diffusers-compatibility, VRAM est."""
    from huggingface_hub import HfApi

    info = HfApi().model_info(repo_id, token=token, files_metadata=True)
    siblings = info.siblings or []
    names = [s.rfilename for s in siblings]

    # Loadable only if it is a diffusers repo (model_index.json) AND actually
    # ships subfolder weights we can fetch — safetensors preferred, else .bin.
    has_index = "model_index.json" in names
    has_safetensors = any(fnmatch.fnmatch(n, "*/*.safetensors") for n in names)
    has_bin = any(fnmatch.fnmatch(n, "*/*.bin") for n in names)
    use_safetensors = has_safetensors
    compatible = has_index and (has_safetensors or has_bin)

    variant = (
        "fp16"
        if use_safetensors and any(fnmatch.fnmatch(n, "*/*.fp16.safetensors") for n in names)
        else None
    )

    allow = set(resolve_download_files(names, variant, use_safetensors))
    size_bytes = sum(s.size or 0 for s in siblings if s.rfilename in allow)
    size_gb = round(size_bytes / (1024**3), 1)

    family = _detect_family(repo_id, list(info.tags or []))
    defaults = _FAMILY_DEFAULTS.get(family, _GENERIC_DEFAULTS)

    model = ModelInfo(
        slug=slug_for(repo_id),
        repo_id=repo_id,
        name=repo_id.split("/")[-1],
        family=family,
        pipeline_tag=getattr(info, "pipeline_tag", None) or "text-to-image",
        description=repo_id,
        gated=bool(info.gated),
        approx_size_gb=size_gb,
        min_vram_gb=estimate_min_vram_gb(size_gb),
        variant=variant,
        use_safetensors=use_safetensors,
        defaults=defaults,
    )
    return ResolvedModel(**model.model_dump(), compatible=compatible, fit=assess(model))


# --- Resolve an upscale/outpaint engine repo ----------------------------------

class EngineWeight(BaseModel):
    """A single downloadable weight file (Real-ESRGAN ``.pth``/safetensors)."""

    filename: str
    approx_size_gb: float


class EngineResolve(BaseModel):
    """A repo inspected for use as a custom upscale/outpaint engine."""

    repo_id: str
    kind: str  # "realesrgan" | "sd_x4" | "inpaint"
    approx_size_gb: float  # diffusers total; 0 for realesrgan (depends on the file)
    compatible: bool
    variant: str | None = None
    use_safetensors: bool = True
    # Real-ESRGAN weight-file candidates (empty for diffusers kinds).
    weights: list[EngineWeight] = []


def resolve_engine(repo_id: str, kind: str, token: str | None) -> EngineResolve:
    """Inspect ``repo_id`` for use as a custom engine of ``kind``.

    ``realesrgan`` lists the repo's single-file weight candidates (a ``.pth`` or a
    root-level ``.safetensors``) so the user can pick one; the diffusers kinds
    (``sd_x4`` / ``inpaint``) resolve the download size, weight variant and
    diffusers-compatibility like :func:`resolve_repo`.
    """
    from huggingface_hub import HfApi

    info = HfApi().model_info(repo_id, token=token, files_metadata=True)
    siblings = info.siblings or []
    names = [s.rfilename for s in siblings]
    size_gb = {s.rfilename: round((s.size or 0) / (1024**3), 2) for s in siblings}

    if kind == "realesrgan":
        # Single-file weights live at the repo root (no subfolder).
        weights = [
            EngineWeight(filename=n, approx_size_gb=size_gb.get(n, 0.0))
            for n in names
            if "/" not in n and (n.endswith(".pth") or n.endswith(".safetensors"))
        ]
        return EngineResolve(
            repo_id=repo_id, kind=kind, approx_size_gb=0.0,
            compatible=len(weights) > 0, weights=weights,
        )

    # Diffusers pipeline (sd_x4 / inpaint).
    has_index = "model_index.json" in names
    has_safetensors = any(fnmatch.fnmatch(n, "*/*.safetensors") for n in names)
    has_bin = any(fnmatch.fnmatch(n, "*/*.bin") for n in names)
    use_safetensors = has_safetensors
    variant = (
        "fp16"
        if use_safetensors and any(fnmatch.fnmatch(n, "*/*.fp16.safetensors") for n in names)
        else None
    )
    allow = set(resolve_download_files(names, variant, use_safetensors))
    size_bytes = sum(s.size or 0 for s in siblings if s.rfilename in allow)
    return EngineResolve(
        repo_id=repo_id,
        kind=kind,
        approx_size_gb=round(size_bytes / (1024**3), 1),
        compatible=has_index and (has_safetensors or has_bin),
        variant=variant,
        use_safetensors=use_safetensors,
    )
