"""Registry of available AI upscaler / outpaint engines.

Kinds supported and selectable by the user:

* ``realesrgan`` — a fast Real-ESRGAN GAN upscaler loaded from a single ``.pth``
  weight via :mod:`spandrel`. No prompt, general purpose.
* ``sd_x4`` — Stable Diffusion x4 latent upscaler (a diffusers repo) run with an
  optional text prompt. Slower and more VRAM-heavy.
* ``face_restore`` — CodeFormer identity-preserving face restoration loaded from a
  single ``.pth`` via :mod:`spandrel` (+ ``spandrel_extra_arches``); faces are
  detected/aligned with :mod:`facexlib` and pasted back. A fidelity weight trades
  identity vs smoothness. No prompt.
* ``inpaint`` — an inpaint model used for the outpaint reframe strategy.
* ``edit`` — a FLUX.1 Kontext model for prompt-based whole-image editing (Post
  Processing); loads from a GGUF-quantized transformer like the FLUX Fill engines.

Each engine downloads into ``models/<slug>`` like a generation model, so the
existing download/progress/delete machinery applies unchanged.

The engine list is JSON-backed: ``engines_catalog.json`` next to the app package
ships the default catalog, and a git-ignored ``data/engines_catalog.json``
override (written by the Settings editor) fully replaces it when present. An
unreadable/invalid override silently falls back to the bundled default.
"""
from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, TypeAdapter

from ..config import DATA_DIR, ensure_dirs


class EngineDefaults(BaseModel):
    """Default generation parameters for an engine. Meaningful for the diffusion
    kinds (``sd_x4`` denoising, ``inpaint`` outpaint composition + hires refine);
    the GAN ``realesrgan`` kind carries zeros (it has no steps/guidance)."""

    steps: int  # denoising / composition steps
    guidance_scale: float  # CFG scale (0 for prompt-free / GAN engines)
    refine_steps: int  # hires refinement pass steps (outpaint); 0 when unused


class UpscalerInfo(BaseModel):
    slug: str
    kind: str  # "realesrgan" | "sd_x4" | "face_restore" | "colorize" | "inpaint" | "edit"
    name: str
    description: str
    repo_id: str
    # Single weight file to fetch for ``realesrgan``; ``None`` for diffusers repos.
    filename: str | None
    scale: int
    approx_size_gb: float
    min_vram_gb: float  # recommended GPU VRAM — drives the GPU-fit badge (see fit.py)
    prompt_capable: bool
    # Weight precision variant for diffusers engines ("fp16" or None); ignored for
    # single-file ``realesrgan`` weights. Threaded into the download + pipeline load
    # so custom fp16-only repos fetch and load their fp16 weights.
    variant: str | None = None
    use_safetensors: bool = True
    # GGUF-quantized transformer source (FLUX Fill inpaint only), mirroring
    # ``ModelInfo``. When set, ``repo_id`` supplies the base components and the
    # transformer is loaded from this ``.gguf``; the download reuses the ModelInfo
    # GGUF path via ``upscale.to_model_info``.
    gguf_repo_id: str | None = None
    gguf_filename: str | None = None
    # Default generation parameters (steps / guidance / hires-refine steps).
    defaults: EngineDefaults

    @property
    def is_gguf(self) -> bool:
        """True when this engine loads a GGUF-quantized transformer (FLUX Fill)."""
        return bool(self.gguf_filename)


# Slug of the inpaint model used for the outpaint reframe strategy.
INPAINT_SLUG = "outpaint--sd-inpaint"
# Default edit (FLUX Kontext) engine — the fp16 repo, loaded at its suggested NF4/int8
# level (bitsandbytes) so it fits ~16 GB while staying LoRA-capable.
EDIT_SLUG = "edit--flux-kontext"

DEFAULT_CATALOG_FILE = Path(__file__).parents[1] / "engines_catalog.json"
OVERRIDE_CATALOG_FILE = DATA_DIR / "engines_catalog.json"

_CATALOG_ADAPTER = TypeAdapter(list[UpscalerInfo])


def default_catalog() -> list[UpscalerInfo]:
    """The bundled default engine catalog shipped with the app."""
    return _CATALOG_ADAPTER.validate_json(DEFAULT_CATALOG_FILE.read_text("utf-8"))


def load_catalog() -> list[UpscalerInfo]:
    """Return the active engine catalog: the user override if present and valid,
    else the bundled default (also the fallback for an invalid override)."""
    if OVERRIDE_CATALOG_FILE.exists():
        try:
            return _CATALOG_ADAPTER.validate_json(OVERRIDE_CATALOG_FILE.read_text("utf-8"))
        except (ValueError, OSError):
            return default_catalog()
    return default_catalog()


def save_catalog(engines: list[UpscalerInfo]) -> list[UpscalerInfo]:
    """Persist ``engines`` as the user override and return the stored value."""
    ensure_dirs()
    OVERRIDE_CATALOG_FILE.write_text(
        json.dumps([e.model_dump() for e in engines], indent=2), "utf-8"
    )
    return engines


def reset_catalog() -> list[UpscalerInfo]:
    """Drop the user override so the bundled default takes effect again."""
    OVERRIDE_CATALOG_FILE.unlink(missing_ok=True)
    return default_catalog()


def all_engines() -> list[UpscalerInfo]:
    """The active engine catalog."""
    return load_catalog()


def get(slug: str) -> UpscalerInfo | None:
    """Return the engine for ``slug`` from the active catalog, or ``None``."""
    return next((u for u in load_catalog() if u.slug == slug), None)
