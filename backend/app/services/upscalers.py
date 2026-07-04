"""Registry of available AI upscaler engines.

Two kinds are supported and selectable by the user:

* ``realesrgan`` — a fast Real-ESRGAN GAN upscaler loaded from a single ``.pth``
  weight via :mod:`spandrel`. No prompt, general purpose.
* ``sd_x4`` — Stable Diffusion x4 latent upscaler (a diffusers repo) run with an
  optional text prompt. Slower and more VRAM-heavy.

Each engine downloads into ``models/<slug>`` like a generation model, so the
existing download/progress/delete machinery applies unchanged.
"""
from __future__ import annotations

from pydantic import BaseModel


class UpscalerInfo(BaseModel):
    slug: str
    kind: str  # "realesrgan" | "sd_x4" | "inpaint"
    name: str
    description: str
    repo_id: str
    # Single weight file to fetch for ``realesrgan``; ``None`` for diffusers repos.
    filename: str | None
    scale: int
    approx_size_gb: float
    prompt_capable: bool
    # Weight precision variant for diffusers engines ("fp16" or None); ignored for
    # single-file ``realesrgan`` weights. Threaded into the download + pipeline load
    # so custom fp16-only repos fetch and load their fp16 weights.
    variant: str | None = None
    use_safetensors: bool = True


UPSCALERS: list[UpscalerInfo] = [
    UpscalerInfo(
        slug="upscaler--realesrgan-x4",
        kind="realesrgan",
        name="Real-ESRGAN x4",
        description="Fast GAN upscaler (4×), general purpose — no prompt needed.",
        repo_id="ai-forever/Real-ESRGAN",
        filename="RealESRGAN_x4.pth",
        scale=4,
        approx_size_gb=0.07,
        prompt_capable=False,
    ),
    UpscalerInfo(
        slug="upscaler--sd-x4",
        kind="sd_x4",
        name="Stable Diffusion x4 Upscaler",
        description="Diffusion upscaler (4×) with an optional text prompt — slower, more VRAM.",
        repo_id="stabilityai/stable-diffusion-x4-upscaler",
        filename=None,
        scale=4,
        approx_size_gb=1.7,
        prompt_capable=True,
    ),
    # The outpaint (inpaint) model. Not a selectable upscaler engine — the frontend
    # filters `kind == "inpaint"` out of the engine picker — but it is listed so its
    # download state can be shown/triggered when the user picks the outpaint reframe.
    UpscalerInfo(
        slug="outpaint--sd-inpaint",
        kind="inpaint",
        # SD 1.5 inpainting (the maintained, ungated re-host of the classic Runway
        # inpainting model). SD 2 inpainting is gated (401); this one is open.
        name="Stable Diffusion Inpainting (outpaint)",
        description="Fills newly-added areas when reframing with the outpaint strategy.",
        repo_id="stable-diffusion-v1-5/stable-diffusion-inpainting",
        filename=None,
        scale=1,
        approx_size_gb=4.3,
        prompt_capable=True,
        # This repo ships only fp16 safetensors; load them with variant="fp16".
        variant="fp16",
    ),
]

# Slug of the inpaint model used for the outpaint reframe strategy.
INPAINT_SLUG = "outpaint--sd-inpaint"


def all_engines() -> list[UpscalerInfo]:
    """Curated engines first, then user-added custom ones.

    Custom engines live in :mod:`custom_upscalers`; the import is lazy to avoid a
    cycle (custom_upscalers imports :class:`UpscalerInfo` from this module)."""
    from . import custom_upscalers

    return [*UPSCALERS, *custom_upscalers.load()]


def get_curated(slug: str) -> UpscalerInfo | None:
    return next((u for u in UPSCALERS if u.slug == slug), None)


def is_curated(slug: str) -> bool:
    return get_curated(slug) is not None


def get(slug: str) -> UpscalerInfo | None:
    """Return the upscaler engine for ``slug`` (curated first, then custom)."""
    from . import custom_upscalers

    return get_curated(slug) or custom_upscalers.get(slug)


def inpaint() -> UpscalerInfo:
    """The default (curated) inpaint engine used for outpainting."""
    engine = get_curated(INPAINT_SLUG)
    assert engine is not None  # defined above
    return engine
