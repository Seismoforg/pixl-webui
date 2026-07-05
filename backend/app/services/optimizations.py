"""Shared diffusers pipeline performance optimisations.

Applies the user-configurable optimisations (VAE tiling / slicing, xformers
memory-efficient attention) to any diffusers pipe. Every call is best-effort: a
pipe that doesn't expose a method, or a missing library (xformers), is skipped
silently so the optimisation never breaks a load.
"""
from __future__ import annotations

from ..config import Settings


def _enable_vae(pipe, vae_method: str, pipe_method: str) -> None:
    """Enable a VAE optimisation, preferring the modern ``pipe.vae.<method>()``
    API and falling back to the deprecated ``pipe.<method>()`` on older diffusers.
    Best-effort: a missing method or a raising call is skipped silently."""
    vae = getattr(pipe, "vae", None)
    fn = getattr(vae, vae_method, None) or getattr(pipe, pipe_method, None)
    if fn is None:
        return
    try:
        fn()
    except Exception:  # noqa: BLE001 - optional optimisation; never fatal
        pass


def apply_perf(pipe, settings: Settings) -> None:
    """Enable the optimisations selected in ``settings`` on ``pipe`` (best-effort)."""
    if settings.vae_tiling:
        _enable_vae(pipe, "enable_tiling", "enable_vae_tiling")
    if settings.vae_slicing:
        _enable_vae(pipe, "enable_slicing", "enable_vae_slicing")
    if settings.xformers:
        try:
            pipe.enable_xformers_memory_efficient_attention()
        except Exception:  # noqa: BLE001 - optional optimisation; never fatal
            pass


def apply_compile(pipe, settings: Settings) -> None:
    """torch.compile the pipe's denoising module when enabled in ``settings``.

    Compiles ``pipe.transformer`` (FLUX/SD3) or ``pipe.unet`` (SD/SDXL) with the
    default mode — no CUDA graphs, so it coexists with CPU offloading. Best-effort:
    any compile failure (common on ROCm) is swallowed so generation continues
    uncompiled. The first run after enabling pays the compile cost."""
    if not settings.torch_compile:
        return
    # The denoising module is `transformer` on FLUX/SD3 and `unet` on SD/SDXL;
    # compile whichever this pipe exposes and assign it back in place.
    attr = None
    if getattr(pipe, "transformer", None) is not None:
        attr = "transformer"
    elif getattr(pipe, "unet", None) is not None:
        attr = "unet"
    if attr is None:
        return
    try:
        import importlib.util

        import torch

        # torch.compile's GPU (inductor) backend needs Triton, and compilation is
        # lazy — it happens on the first forward pass, outside this guard. Without
        # Triton that first pass would raise and break generation, so when running
        # on GPU without Triton we skip: the toggle becomes a safe no-op instead.
        if torch.cuda.is_available() and importlib.util.find_spec("triton") is None:
            return
        setattr(pipe, attr, torch.compile(getattr(pipe, attr)))
    except Exception:  # noqa: BLE001 - optional optimisation; never fatal
        pass
