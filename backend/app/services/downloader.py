"""Model download service.

Downloads a catalog model into ``models/<slug>`` (no global HF cache) on a
background thread and exposes a size-based progress estimate. A ``.pixl_complete``
marker file records a finished download so completion survives restarts.
"""
from __future__ import annotations

import fnmatch
import re
import threading
import time
from pathlib import Path

from pydantic import BaseModel

from .. import config, messages
from ..catalog import GenerationDefaults, ModelInfo
from .fit import FitInfo, assess

_COMPLETE_MARKER = ".pixl_complete"

# HuggingFace downloads over flaky links often drop mid-stream (Windows surfaces
# this as "[WinError 10054] connection reset"). Retrying resumes already-fetched
# files rather than restarting, so a few attempts usually push it through.
_MAX_DOWNLOAD_ATTEMPTS = 5
_TRANSIENT_MARKERS = (
    "10054", "10053", "10060", "connection", "connectionreset", "reset by peer",
    "timed out", "timeout", "temporarily", "chunkedencoding", "incompleteread",
    "remotedisconnected", "econnreset", "broken pipe",
)


def _is_transient(exc: BaseException) -> bool:
    if isinstance(exc, (ConnectionError, TimeoutError, OSError)):
        return True
    text = str(exc).lower()
    return any(m in text for m in _TRANSIENT_MARKERS)


def _download_with_retries(do_download) -> None:
    """Run ``do_download()``, retrying transient network failures with backoff.

    HuggingFace resumes partially-downloaded files, so each retry continues from
    where it stopped. Non-transient errors (auth, 404, disk) raise immediately.
    """
    for attempt in range(1, _MAX_DOWNLOAD_ATTEMPTS + 1):
        try:
            do_download()
            return
        except Exception as exc:  # noqa: BLE001 - decide retry vs. surface
            if attempt >= _MAX_DOWNLOAD_ATTEMPTS or not _is_transient(exc):
                raise
            time.sleep(min(2 ** attempt, 15))

# Non-weight files needed to load a diffusers model (configs, tokenizers). These
# are tiny and may live at the repo root (e.g. model_index.json).
_BASE_PATTERNS = ["*.json", "*.txt", "*.model"]


def _component_weight_files(
    names: list[str], variant: str | None, use_safetensors: bool
) -> list[str]:
    """Pick one weight file per diffusers component subfolder.

    Repos are often *mixed-variant*: some components (e.g. ``unet``) ship an
    ``.fp16`` weight while others (e.g. ``text_encoder``) ship only the
    full-precision file. Choosing a single repo-wide pattern like
    ``*/*.fp16.safetensors`` would then silently skip the components without an
    fp16 file, leaving the download unloadable. So we group by subfolder and take
    the fp16 file when a variant is requested and present, else the plain file —
    every component ends up with weights. (diffusers loads the fp16 components and
    transparently falls back to the plain file for the rest.)

    Only subfolder weights are considered; root-level single-file checkpoints
    (``model.safetensors`` and friends at the repo root) are ignored.
    """
    ext = ".bin" if not use_safetensors else ".safetensors"
    fp16_suffix = ".fp16" + ext

    by_dir: dict[str, list[str]] = {}
    for n in names:
        if "/" in n and n.endswith(ext):
            by_dir.setdefault(n.rsplit("/", 1)[0], []).append(n)

    chosen: list[str] = []
    for files in by_dir.values():
        fp16 = [f for f in files if f.endswith(fp16_suffix)]
        plain = [f for f in files if not f.endswith(fp16_suffix)]
        if variant == "fp16" and fp16:
            chosen.extend(fp16)
        elif plain:
            chosen.extend(plain)
        else:
            chosen.extend(fp16)
    return chosen


def resolve_download_files(
    names: list[str], variant: str | None, use_safetensors: bool
) -> list[str]:
    """Exact list of repo files to download: config/tokenizer files plus one
    weight file per component (see :func:`_component_weight_files`)."""
    base = [n for n in names if any(fnmatch.fnmatch(n, p) for p in _BASE_PATTERNS)]
    return base + _component_weight_files(names, variant, use_safetensors)


class DownloadState(BaseModel):
    status: str  # "downloading" | "done" | "error"
    total_bytes: int = 0
    error: str | None = None


class DownloadProgress(BaseModel):
    slug: str
    status: str  # "idle" | "downloading" | "done" | "error"
    downloaded_bytes: int
    total_bytes: int
    percent: float
    error: str | None = None


# slug -> live download state (only for downloads started this process)
_states: dict[str, DownloadState] = {}
_lock = threading.Lock()


def is_downloaded(slug: str) -> bool:
    """True if a completed download exists on disk for ``slug``."""
    return (config.model_dir(slug) / _COMPLETE_MARKER).exists()


def delete_model(slug: str) -> None:
    """Remove a downloaded model's files from disk.

    Raises ValueError if a download for the model is currently running.
    """
    import shutil

    with _lock:
        current = _states.get(slug)
        if current and current.status == "downloading":
            raise ValueError(messages.DOWNLOAD_ALREADY_RUNNING.format(slug=slug))
        _states.pop(slug, None)

    target = config.model_dir(slug)
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def _run_download(model: ModelInfo, token: str | None, allow: list[str]) -> None:
    from huggingface_hub import snapshot_download

    target = config.model_dir(model.slug)
    try:
        _download_with_retries(
            lambda: snapshot_download(
                repo_id=model.repo_id,
                local_dir=str(target),
                token=token,
                allow_patterns=allow,
                local_dir_use_symlinks=False,
            )
        )
        (target / _COMPLETE_MARKER).touch()
        with _lock:
            _states[model.slug].status = "done"
    except Exception as exc:  # noqa: BLE001 - surfaced to the user via state
        with _lock:
            _states[model.slug].status = "error"
            _states[model.slug].error = str(exc)


def _mark_downloading(slug: str) -> None:
    """Register ``slug`` as downloading *synchronously* (before any network call).

    Doing this up front — rather than after the HuggingFace metadata fetch — closes
    the race where ``get_progress`` briefly returns ``idle`` after the user starts a
    download, which the live UI would otherwise read as "not downloading". Raises
    ValueError if a download for the slug is already running.
    """
    with _lock:
        current = _states.get(slug)
        if current and current.status == "downloading":
            raise ValueError(messages.DOWNLOAD_ALREADY_RUNNING.format(slug=slug))
        _states[slug] = DownloadState(status="downloading", total_bytes=0)


def _run_file_download(slug: str, repo_id: str, filename: str, token: str | None) -> None:
    from huggingface_hub import HfApi, hf_hub_download

    target = config.model_dir(slug)
    try:
        try:  # size is only a progress hint; never fail the download over it
            info = HfApi().model_info(repo_id, token=token, files_metadata=True)
            total = next(
                (s.size or 0 for s in (info.siblings or []) if s.rfilename == filename), 0
            )
            with _lock:
                _states[slug].total_bytes = total
        except Exception:  # noqa: BLE001
            pass
        _download_with_retries(
            lambda: hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=str(target),
                token=token,
                local_dir_use_symlinks=False,
            )
        )
        (target / _COMPLETE_MARKER).touch()
        with _lock:
            _states[slug].status = "done"
    except Exception as exc:  # noqa: BLE001 - surfaced to the user via state
        with _lock:
            _states[slug].status = "error"
            _states[slug].error = str(exc)


def start_file_download(slug: str, repo_id: str, filename: str, token: str | None) -> None:
    """Download a single file (e.g. an upscaler ``.pth``) into ``models/<slug>``.

    Uses the same progress/state machinery as :func:`start_download` so the
    frontend can poll it via :func:`get_progress` unchanged. Raises ValueError if
    a download for the same slug is already running.
    """
    _mark_downloading(slug)
    thread = threading.Thread(
        target=_run_file_download, args=(slug, repo_id, filename, token), daemon=True
    )
    thread.start()


def _prepare_and_download(model: ModelInfo, token: str | None) -> None:
    """Resolve the file list + size (network), then download. Runs on the thread so
    the state is already ``downloading`` before this (slow) work begins."""
    from huggingface_hub import HfApi

    try:
        info = HfApi().model_info(model.repo_id, token=token, files_metadata=True)
        siblings = info.siblings or []
        names = [s.rfilename for s in siblings]
        allow = resolve_download_files(names, model.variant, model.use_safetensors)
        allow_set = set(allow)
        total = sum(s.size or 0 for s in siblings if s.rfilename in allow_set)
        with _lock:
            _states[model.slug].total_bytes = total
    except Exception as exc:  # noqa: BLE001 - surfaced to the user via state
        with _lock:
            _states[model.slug].status = "error"
            _states[model.slug].error = str(exc)
        return

    _run_download(model, token, allow)


def start_download(model: ModelInfo, token: str | None) -> None:
    """Begin downloading ``model`` in the background.

    Marks the download as running synchronously, then resolves the exact
    per-component file list + size and downloads on a background thread (so
    mixed-variant repos fetch all weights, not just the fp16 ones). Raises
    ValueError if a download for the same model is already running.
    """
    _mark_downloading(model.slug)
    thread = threading.Thread(target=_prepare_and_download, args=(model, token), daemon=True)
    thread.start()


def get_progress(slug: str) -> DownloadProgress:
    """Return the current progress for ``slug``."""
    with _lock:
        state = _states.get(slug)

    if state is None:
        status = "done" if is_downloaded(slug) else "idle"
        return DownloadProgress(
            slug=slug, status=status, downloaded_bytes=0, total_bytes=0, percent=0.0
        )

    downloaded = _dir_size(config.model_dir(slug))
    total = state.total_bytes
    percent = 100.0 if state.status == "done" else (
        min(99.0, downloaded / total * 100.0) if total else 0.0
    )
    return DownloadProgress(
        slug=slug,
        status=state.status,
        downloaded_bytes=downloaded,
        total_bytes=total,
        percent=round(percent, 1),
        error=state.error,
    )


# --- HuggingFace browsing: search + resolve arbitrary diffusers repos ---------

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
