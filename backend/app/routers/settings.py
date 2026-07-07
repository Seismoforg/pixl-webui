"""Settings endpoints (HuggingFace token)."""
from __future__ import annotations

from fastapi import APIRouter

from ..config import Settings, load_settings, save_settings
from ..services import pipeline, upscale

router = APIRouter(prefix="/api", tags=["settings"])

_PERF_FIELDS = (
    "vae_tiling", "vae_slicing", "attention_slicing", "vae_on_gpu",
    "xformers", "torch_compile", "tunable_ops",
)


@router.get("/settings", response_model=Settings)
def read_settings() -> Settings:
    return load_settings()


@router.post("/settings", response_model=Settings)
def update_settings(settings: Settings) -> Settings:
    previous = load_settings()
    saved = save_settings(settings)
    # Cached pipelines applied the old optimisations at load time; drop them so the
    # next generation/upscale reloads with the new flags.
    if any(getattr(previous, f) != getattr(saved, f) for f in _PERF_FIELDS):
        pipeline.unload()
        upscale.unload()
    return saved
