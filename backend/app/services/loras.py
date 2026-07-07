"""Registry of available LoRA adapters (domain data).

A LoRA is a small weight file that biases a base model toward a style/subject/
concept without a full fine-tuned checkpoint. Each entry is family-scoped (only
applies to matching base models) and downloads its single ``.safetensors`` file
into ``models/<slug>`` via the existing single-file download machinery.

JSON-backed like the model/engine catalogs: ``loras_catalog.json`` next to the app
package ships the default, and a git-ignored ``data/loras_catalog.json`` override
(written by the Settings editor) fully replaces it. An unreadable/invalid override
silently falls back to the bundled default.
"""
from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, TypeAdapter

from ..config import DATA_DIR, ensure_dirs


class LoraInfo(BaseModel):
    slug: str
    repo_id: str
    filename: str  # the single .safetensors weight to fetch + load
    name: str
    family: str  # "SD 1.5" | "SDXL" | "FLUX" — must match the base model to apply
    description: str = ""
    # Broad category shown as a badge in the UI. One of: style | character | concept
    # | realism | accelerator | other. Defaults to "other" so pre-existing overrides
    # (which lack the field) stay valid.
    kind: str = "other"
    # Optional trigger word(s) to add to the prompt for this LoRA to take effect.
    trigger: str | None = None
    approx_size_gb: float = 0.0


DEFAULT_CATALOG_FILE = Path(__file__).parents[1] / "loras_catalog.json"
OVERRIDE_CATALOG_FILE = DATA_DIR / "loras_catalog.json"

_CATALOG_ADAPTER = TypeAdapter(list[LoraInfo])


def default_catalog() -> list[LoraInfo]:
    """The bundled default LoRA catalog shipped with the app."""
    return _CATALOG_ADAPTER.validate_json(DEFAULT_CATALOG_FILE.read_text("utf-8"))


def load_catalog() -> list[LoraInfo]:
    """Return the active LoRA catalog: the user override if present and valid, else
    the bundled default (also the fallback for an invalid override)."""
    if OVERRIDE_CATALOG_FILE.exists():
        try:
            return _CATALOG_ADAPTER.validate_json(OVERRIDE_CATALOG_FILE.read_text("utf-8"))
        except (ValueError, OSError):
            return default_catalog()
    return default_catalog()


def save_catalog(loras: list[LoraInfo]) -> list[LoraInfo]:
    """Persist ``loras`` as the user override and return the stored value."""
    ensure_dirs()
    OVERRIDE_CATALOG_FILE.write_text(
        json.dumps([lora.model_dump() for lora in loras], indent=2), "utf-8"
    )
    return loras


def reset_catalog() -> list[LoraInfo]:
    """Drop the user override so the bundled default takes effect again."""
    OVERRIDE_CATALOG_FILE.unlink(missing_ok=True)
    return default_catalog()


def all_loras() -> list[LoraInfo]:
    """The active LoRA catalog."""
    return load_catalog()


def get(slug: str) -> LoraInfo | None:
    """Return the LoRA for ``slug`` from the active catalog, or ``None``."""
    return next((lora for lora in load_catalog() if lora.slug == slug), None)
