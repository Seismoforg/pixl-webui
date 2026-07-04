"""Shared diffusers pipeline performance optimisations.

Applies the user-configurable optimisations (VAE tiling / slicing, xformers
memory-efficient attention) to any diffusers pipe. Every call is best-effort: a
pipe that doesn't expose a method, or a missing library (xformers), is skipped
silently so the optimisation never breaks a load.
"""
from __future__ import annotations

from ..config import Settings


def apply_perf(pipe, settings: Settings) -> None:
    """Enable the optimisations selected in ``settings`` on ``pipe`` (best-effort)."""
    toggles = [
        (settings.vae_tiling, "enable_vae_tiling"),
        (settings.vae_slicing, "enable_vae_slicing"),
        (settings.xformers, "enable_xformers_memory_efficient_attention"),
    ]
    for enabled, method in toggles:
        if not enabled:
            continue
        try:
            getattr(pipe, method)()
        except Exception:  # noqa: BLE001 - optional optimisation; never fatal
            pass
