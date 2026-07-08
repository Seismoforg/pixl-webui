"""Model download service.

Downloads a catalog model into ``models/<slug>`` (no global HF cache) on a
background thread and exposes a size-based progress estimate. A ``.pixl_complete``
marker file records a finished download so completion survives restarts.
"""
from __future__ import annotations

import fnmatch
import threading
import time
from pathlib import Path

from pydantic import BaseModel

from .. import config, live, messages
from ..catalog import ModelInfo

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
    # Only network errors are transient. NOT a blanket OSError catch: disk-full
    # (ENOSPC) / permission (EACCES) are OSErrors too but non-recoverable — retrying
    # them just wastes ~30s of backoff. Socket OSErrors are caught via the markers below.
    if isinstance(exc, (ConnectionError, TimeoutError)):
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
# are tiny and may live at the repo root (e.g. model_index.json). ``*.jinja`` covers
# a tokenizer's ``chat_template.jinja`` (e.g. FLUX.2's Qwen3 encoder), which the
# pipeline needs to format the prompt — without it prompt encoding raises.
_BASE_PATTERNS = ["*.json", "*.txt", "*.model", "*.jinja"]


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


def resolve_gguf_base_files(
    names: list[str], variant: str | None, use_safetensors: bool
) -> list[str]:
    """Base-repo file list for a GGUF model: :func:`resolve_download_files` minus
    the transformer weight files, which the ``.gguf`` replaces. The transformer's
    config JSON is kept (matched by ``*.json``) so the loader's ``from_single_file``
    can read it locally instead of hitting the network."""
    weight_exts = (".safetensors", ".bin")
    return [
        n
        for n in resolve_download_files(names, variant, use_safetensors)
        if not (n.startswith("transformer/") and n.endswith(weight_exts))
    ]


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
        live.publish(f"download:{model.slug}")
    except Exception as exc:  # noqa: BLE001 - surfaced to the user via state
        with _lock:
            _states[model.slug].status = "error"
            _states[model.slug].error = str(exc)
        live.publish(f"download:{model.slug}")


def _run_gguf_download(model: ModelInfo, token: str | None, allow: list[str]) -> None:
    """Download a GGUF model: the base repo (without the transformer weights) plus
    the single ``.gguf`` transformer file, both into ``models/<slug>``."""
    from huggingface_hub import hf_hub_download, snapshot_download

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
        _download_with_retries(
            lambda: hf_hub_download(
                repo_id=model.gguf_repo_id,
                filename=model.gguf_filename,
                local_dir=str(target),
                token=token,
                local_dir_use_symlinks=False,
            )
        )
        (target / _COMPLETE_MARKER).touch()
        with _lock:
            _states[model.slug].status = "done"
        live.publish(f"download:{model.slug}")
    except Exception as exc:  # noqa: BLE001 - surfaced to the user via state
        with _lock:
            _states[model.slug].status = "error"
            _states[model.slug].error = str(exc)
        live.publish(f"download:{model.slug}")


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
    live.publish(f"download:{slug}")


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
            live.publish(f"download:{slug}")
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
        live.publish(f"download:{slug}")
    except Exception as exc:  # noqa: BLE001 - surfaced to the user via state
        with _lock:
            _states[slug].status = "error"
            _states[slug].error = str(exc)
        live.publish(f"download:{slug}")


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


def _run_civitai_download(slug: str, version_id: int, filename: str, token: str | None) -> None:
    """Stream a single Civitai model-version file into ``models/<slug>/<filename>``.

    Civitai isn't a HuggingFace repo, so this bypasses ``huggingface_hub``: it GETs
    ``/api/download/models/{version_id}`` (auth via the Civitai API key) and streams the
    body to disk. Reuses the shared progress state so the UI polls it like any download.
    """
    import requests

    target = config.model_dir(slug)
    target.mkdir(parents=True, exist_ok=True)
    dest = target / filename
    url = f"https://civitai.com/api/download/models/{version_id}"
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    def do_download() -> None:
        with requests.get(url, headers=headers, stream=True, allow_redirects=True, timeout=60) as resp:
            if resp.status_code in (401, 403):
                raise ValueError(messages.CIVITAI_AUTH_REQUIRED)
            resp.raise_for_status()
            total = int(resp.headers.get("Content-Length") or 0)
            if total:
                with _lock:
                    _states[slug].total_bytes = total
                live.publish(f"download:{slug}")
            part = dest.with_name(dest.name + ".part")
            with open(part, "wb") as handle:
                for chunk in resp.iter_content(chunk_size=1 << 20):
                    if chunk:
                        handle.write(chunk)
            part.replace(dest)

    try:
        _download_with_retries(do_download)
        (target / _COMPLETE_MARKER).touch()
        with _lock:
            _states[slug].status = "done"
        live.publish(f"download:{slug}")
    except Exception as exc:  # noqa: BLE001 - surfaced to the user via state
        with _lock:
            _states[slug].status = "error"
            _states[slug].error = str(exc)
        live.publish(f"download:{slug}")


def start_civitai_download(slug: str, version_id: int, filename: str, token: str | None) -> None:
    """Download a single Civitai file into ``models/<slug>`` on a background thread.

    Same progress/state machinery as :func:`start_file_download`; used for LoRAs (and
    later checkpoints) hosted on civitai.com rather than HuggingFace. Raises ValueError
    if a download for the same slug is already running."""
    _mark_downloading(slug)
    thread = threading.Thread(
        target=_run_civitai_download, args=(slug, version_id, filename, token), daemon=True
    )
    thread.start()


def _prepare_and_download(model: ModelInfo, token: str | None) -> None:
    """Resolve the file list + size (network), then download. Runs on the thread so
    the state is already ``downloading`` before this (slow) work begins."""
    from huggingface_hub import HfApi

    api = HfApi()
    try:
        info = api.model_info(model.repo_id, token=token, files_metadata=True)
        siblings = info.siblings or []
        names = [s.rfilename for s in siblings]
        if model.is_gguf:
            allow = resolve_gguf_base_files(names, model.variant, model.use_safetensors)
            gguf_info = api.model_info(model.gguf_repo_id, token=token, files_metadata=True)
            gguf_size = next(
                (s.size or 0 for s in (gguf_info.siblings or [])
                 if s.rfilename == model.gguf_filename),
                0,
            )
        else:
            allow = resolve_download_files(names, model.variant, model.use_safetensors)
            gguf_size = 0
        allow_set = set(allow)
        total = sum(s.size or 0 for s in siblings if s.rfilename in allow_set) + gguf_size
        with _lock:
            _states[model.slug].total_bytes = total
        live.publish(f"download:{model.slug}")
    except Exception as exc:  # noqa: BLE001 - surfaced to the user via state
        with _lock:
            _states[model.slug].status = "error"
            _states[model.slug].error = str(exc)
        live.publish(f"download:{model.slug}")
        return

    if model.is_gguf:
        _run_gguf_download(model, token, allow)
    else:
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
