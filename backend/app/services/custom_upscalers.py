"""Persistence for user-added (non-curated) upscale/outpaint engines.

Curated engines live in ``upscalers.py``. Engines the user adds (a custom
Real-ESRGAN weight, an SD-x4 diffusers upscaler, or an inpaint model for
outpainting) are stored here as :class:`UpscalerInfo` entries in
``data/custom_upscalers.json`` so download, deletion and running keep working
purely by slug — mirroring :mod:`custom_models`.
"""
from __future__ import annotations

import json
import threading

from .. import config
from .upscalers import UpscalerInfo

_FILE = config.DATA_DIR / "custom_upscalers.json"
_lock = threading.Lock()


def load() -> list[UpscalerInfo]:
    """Return the persisted custom engines (empty if none or unreadable)."""
    if not _FILE.exists():
        return []
    try:
        raw = json.loads(_FILE.read_text("utf-8"))
        return [UpscalerInfo.model_validate(entry) for entry in raw]
    except (ValueError, OSError):
        return []


def _save(engines: list[UpscalerInfo]) -> None:
    config.ensure_dirs()
    _FILE.write_text(json.dumps([e.model_dump() for e in engines], indent=2), "utf-8")


def add(engine: UpscalerInfo) -> None:
    """Persist ``engine``, replacing any existing entry with the same slug."""
    with _lock:
        engines = [e for e in load() if e.slug != engine.slug]
        engines.append(engine)
        _save(engines)


def remove(slug: str) -> None:
    """Drop the custom entry for ``slug`` if present (no-op otherwise)."""
    with _lock:
        engines = [e for e in load() if e.slug != slug]
        _save(engines)


def get(slug: str) -> UpscalerInfo | None:
    return next((e for e in load() if e.slug == slug), None)
