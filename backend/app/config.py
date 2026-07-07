"""Project paths, environment setup and the settings store.

Importing this module has the side effect of pointing all HuggingFace caches at
the project-local ``models/.hf`` directory, so nothing is written to the global
HuggingFace cache. Import it before ``huggingface_hub`` / ``diffusers``.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from pydantic import BaseModel

# backend/app/config.py -> app -> backend -> project root
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = PROJECT_ROOT / "models"
DATA_DIR = PROJECT_ROOT / "data"
OUTPUTS_DIR = PROJECT_ROOT / "outputs"
HF_HOME = MODELS_DIR / ".hf"
SETTINGS_FILE = DATA_DIR / "settings.json"

# Keep every HuggingFace cache inside the project (no global cache folder).
os.environ.setdefault("HF_HOME", str(HF_HOME))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
# Disable the Xet backend: on Windows its temp files under
# .cache/huggingface/download/ trigger "[WinError 123]" (invalid path). The
# classic HTTPS download path is reliable. Must be set before huggingface_hub.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

# MIOpen (AMD ROCm) caches compiled kernels and convolution tuning results.
# Pin its DB/cache into the project so the first-run "warmup" tuning persists and
# later runs — even after a restart — reuse it instead of re-tuning. Harmless on
# NVIDIA/CPU (MIOpen is not loaded there). Keyed by GPU arch + tensor shapes, so
# the cache is reused as long as the model and image resolution stay the same.
MIOPEN_DIR = DATA_DIR / "miopen"
os.environ.setdefault("MIOPEN_USER_DB_PATH", str(MIOPEN_DIR))
os.environ.setdefault("MIOPEN_CUSTOM_CACHE_DIR", str(MIOPEN_DIR))
os.environ.setdefault("MIOPEN_FIND_MODE", "2")  # FAST: prefer find-db over long search

# ROCm TunableOp tunes GEMM kernels to the actual GPU (enabled at runtime for ROCm
# in the pipeline). Pin its results file into the project so the one-time tuning —
# like the MIOpen warmup above — persists and is reused across restarts. Harmless
# off ROCm: the file is only written when TunableOp is enabled.
os.environ.setdefault("PYTORCH_TUNABLEOP_FILENAME", str(DATA_DIR / "tunableop_results.csv"))


class Settings(BaseModel):
    """User-configurable settings persisted to ``data/settings.json``."""

    hf_token: str | None = None
    # Pipeline performance optimisations (applied to generation + upscale on load).
    # Default on; all are best-effort so absent hardware/libs are no-ops.
    vae_tiling: bool = True
    vae_slicing: bool = True
    xformers: bool = True
    # Compile the denoising module (transformer/UNet) with torch.compile on load for
    # faster iterations. Default off: the first run after enabling pays a long
    # compile cost, and support is uneven on ROCm. Best-effort — a failed compile
    # falls back to eager (see optimizations.apply_compile).
    torch_compile: bool = False
    # Denoising steps for the SD x4 diffusion upscaler. The diffusers default is 75;
    # 30–50 are visually near-identical for this upscaler and much faster (the cost
    # multiplies across tiles). Read per-run, so changes take effect without reload.
    sd_x4_steps: int = 50
    # Built-in negative prompt base for AI outpainting; fights the common failure
    # modes (stock watermarks/text and duplicated subjects). A run's per-run outpaint
    # negative is appended to this. Read per-run, so edits take effect without reload.
    outpaint_negative: str = (
        "watermark, text, signature, caption, frame, border, collage, grid, "
        "multiple animals, duplicate, extra subject, blurry, distorted, low quality"
    )
    # Preferred default selections for the model / upscaler / outpaint-engine
    # dropdowns (slugs). Each is used only when set AND currently downloaded; else
    # the UI falls back to the first downloaded entry of that kind.
    default_model: str | None = None
    default_upscaler: str | None = None
    default_outpaint_engine: str | None = None


def ensure_dirs() -> None:
    """Create the project-local runtime directories if missing."""
    for directory in (MODELS_DIR, DATA_DIR, OUTPUTS_DIR, HF_HOME, MIOPEN_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def load_settings() -> Settings:
    """Load settings from disk, returning defaults when absent or invalid."""
    if not SETTINGS_FILE.exists():
        return Settings()
    try:
        return Settings.model_validate_json(SETTINGS_FILE.read_text("utf-8"))
    except (ValueError, OSError):
        return Settings()


def save_settings(settings: Settings) -> Settings:
    """Persist settings to disk and return the stored value."""
    ensure_dirs()
    SETTINGS_FILE.write_text(settings.model_dump_json(indent=2), "utf-8")
    return settings


def model_dir(slug: str) -> Path:
    """Local directory a model with ``slug`` is downloaded into."""
    return MODELS_DIR / slug
