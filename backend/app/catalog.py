"""Curated model catalog (domain data).

The catalog is the single source of truth for which models the UI offers, their
HuggingFace repository ids and sensible default generation parameters. It is
JSON-backed: ``models_catalog.json`` next to this module ships the default
catalog, and a git-ignored ``data/models_catalog.json`` override (written by the
Settings editor) fully replaces it when present. An unreadable/invalid override
silently falls back to the bundled default so the app never fails to start.
"""
from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, TypeAdapter

from .config import DATA_DIR, ensure_dirs


class GenerationDefaults(BaseModel):
    steps: int
    guidance_scale: float
    width: int
    height: int


class ModelInfo(BaseModel):
    slug: str
    repo_id: str
    name: str
    family: str  # "SD 1.5" | "SDXL" | "FLUX" | "SD 3.x" | "Z-Image" | "FLUX.2"
    # HuggingFace pipeline tag, e.g. "text-to-image". Defaults so curated entries
    # and already-saved custom models report text-to-image without extra data.
    pipeline_tag: str = "text-to-image"
    description: str
    gated: bool
    approx_size_gb: float  # approximate download size for the filtered file set
    min_vram_gb: float  # recommended GPU VRAM for comfortable inference
    # Weight precision variant to fetch/load ("fp16" or None for single-precision
    # repos). Only fp16 diffusers-format safetensors are downloaded — see downloader.
    variant: str | None
    # Whether the subfolder weights are safetensors. Curated models are; some
    # community diffusers repos ship only .bin (pickle) weights → False. Drives
    # both the download patterns and the pipeline loader.
    use_safetensors: bool = True
    # GGUF-quantized variant (FLUX only). When set, the transformer is loaded from
    # this single ``.gguf`` file instead of ``repo_id``'s transformer weights;
    # ``repo_id`` still supplies the remaining components (VAE, text encoders,
    # tokenizers, scheduler). Absent (None) for normal full-precision models.
    gguf_repo_id: str | None = None
    gguf_filename: str | None = None
    defaults: GenerationDefaults

    @property
    def is_gguf(self) -> bool:
        """True when this entry loads a GGUF-quantized transformer."""
        return bool(self.gguf_filename)


DEFAULT_CATALOG_FILE = Path(__file__).parent / "models_catalog.json"
OVERRIDE_CATALOG_FILE = DATA_DIR / "models_catalog.json"

_CATALOG_ADAPTER = TypeAdapter(list[ModelInfo])


def default_catalog() -> list[ModelInfo]:
    """The bundled default catalog shipped with the app."""
    return _CATALOG_ADAPTER.validate_json(DEFAULT_CATALOG_FILE.read_text("utf-8"))


def load_catalog() -> list[ModelInfo]:
    """Return the active catalog: the user override if present and valid, else
    the bundled default (also the fallback for an invalid override)."""
    if OVERRIDE_CATALOG_FILE.exists():
        try:
            return _CATALOG_ADAPTER.validate_json(OVERRIDE_CATALOG_FILE.read_text("utf-8"))
        except (ValueError, OSError):
            return default_catalog()
    return default_catalog()


def save_catalog(models: list[ModelInfo]) -> list[ModelInfo]:
    """Persist ``models`` as the user override and return the stored value."""
    ensure_dirs()
    OVERRIDE_CATALOG_FILE.write_text(
        json.dumps([m.model_dump() for m in models], indent=2), "utf-8"
    )
    return models


def reset_catalog() -> list[ModelInfo]:
    """Drop the user override so the bundled default takes effect again."""
    OVERRIDE_CATALOG_FILE.unlink(missing_ok=True)
    return default_catalog()


def get_model(slug: str) -> ModelInfo | None:
    """Return the active-catalog entry for ``slug`` or ``None``."""
    return next((m for m in load_catalog() if m.slug == slug), None)
