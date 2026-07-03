"""Persistence for user-added (non-curated) models.

Curated models live in ``catalog.py``. Models the user adds from the HuggingFace
browser are stored here as resolved :class:`ModelInfo` entries in
``data/custom_models.json`` so downloads, deletion and generation keep working
purely by slug — no special-casing anywhere else.
"""
from __future__ import annotations

import json
import threading

from .. import config
from ..catalog import ModelInfo, get_model as _get_curated

_FILE = config.DATA_DIR / "custom_models.json"
_lock = threading.Lock()


def load() -> list[ModelInfo]:
    """Return the persisted custom models (empty if none or unreadable)."""
    if not _FILE.exists():
        return []
    try:
        raw = json.loads(_FILE.read_text("utf-8"))
        return [ModelInfo.model_validate(entry) for entry in raw]
    except (ValueError, OSError):
        return []


def _save(models: list[ModelInfo]) -> None:
    config.ensure_dirs()
    _FILE.write_text(
        json.dumps([m.model_dump() for m in models], indent=2), "utf-8"
    )


def add(model: ModelInfo) -> None:
    """Persist ``model``, replacing any existing entry with the same slug."""
    with _lock:
        models = [m for m in load() if m.slug != model.slug]
        models.append(model)
        _save(models)


def remove(slug: str) -> None:
    """Drop the custom entry for ``slug`` if present (no-op otherwise)."""
    with _lock:
        models = [m for m in load() if m.slug != slug]
        _save(models)


def get(slug: str) -> ModelInfo | None:
    return next((m for m in load() if m.slug == slug), None)


def resolve_model(slug: str) -> ModelInfo | None:
    """Resolve a slug to its :class:`ModelInfo`: curated first, then custom."""
    return _get_curated(slug) or get(slug)
