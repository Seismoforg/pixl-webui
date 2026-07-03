"""Curated model catalog (domain data).

The catalog is the single source of truth for which models the UI offers, their
HuggingFace repository ids and sensible default generation parameters.
"""
from __future__ import annotations

from pydantic import BaseModel


class GenerationDefaults(BaseModel):
    steps: int
    guidance_scale: float
    width: int
    height: int


class ModelInfo(BaseModel):
    slug: str
    repo_id: str
    name: str
    family: str  # "SD 1.5" | "SDXL" | "FLUX" | "SD 3.x"
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
    defaults: GenerationDefaults


CATALOG: list[ModelInfo] = [
    ModelInfo(
        slug="sd15",
        repo_id="stable-diffusion-v1-5/stable-diffusion-v1-5",
        name="Stable Diffusion 1.5",
        family="SD 1.5",
        description="Lightweight, runs on almost any GPU. Huge ecosystem.",
        gated=False,
        approx_size_gb=2.7,
        min_vram_gb=4.0,
        variant="fp16",
        defaults=GenerationDefaults(steps=30, guidance_scale=7.5, width=512, height=512),
    ),
    ModelInfo(
        slug="sdxl",
        repo_id="stabilityai/stable-diffusion-xl-base-1.0",
        name="Stable Diffusion XL",
        family="SDXL",
        description="High quality, widely used. Good quality/VRAM balance.",
        gated=False,
        approx_size_gb=7.1,
        min_vram_gb=8.0,
        variant="fp16",
        defaults=GenerationDefaults(steps=30, guidance_scale=7.0, width=1024, height=1024),
    ),
    ModelInfo(
        slug="flux-schnell",
        repo_id="black-forest-labs/FLUX.1-schnell",
        name="FLUX.1 schnell",
        family="FLUX",
        description="Modern, fast, few-step model. Open weights.",
        gated=False,
        approx_size_gb=34.0,
        min_vram_gb=24.0,
        variant=None,
        defaults=GenerationDefaults(steps=4, guidance_scale=0.0, width=1024, height=1024),
    ),
    ModelInfo(
        slug="flux-dev",
        repo_id="black-forest-labs/FLUX.1-dev",
        name="FLUX.1 dev",
        family="FLUX",
        description="High quality FLUX variant. Gated — needs a HuggingFace token.",
        gated=True,
        approx_size_gb=34.0,
        min_vram_gb=24.0,
        variant=None,
        defaults=GenerationDefaults(steps=28, guidance_scale=3.5, width=1024, height=1024),
    ),
    ModelInfo(
        slug="sd35-large",
        repo_id="stabilityai/stable-diffusion-3.5-large",
        name="Stable Diffusion 3.5 Large",
        family="SD 3.x",
        description="Modern SD 3.5. Gated — needs a HuggingFace token.",
        gated=True,
        approx_size_gb=28.0,
        min_vram_gb=16.0,
        variant=None,
        defaults=GenerationDefaults(steps=28, guidance_scale=4.5, width=1024, height=1024),
    ),
]

_BY_SLUG = {m.slug: m for m in CATALOG}


def get_model(slug: str) -> ModelInfo | None:
    """Return the catalog entry for ``slug`` or ``None``."""
    return _BY_SLUG.get(slug)
