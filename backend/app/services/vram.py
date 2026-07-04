"""VRAM hygiene helpers shared by the generation and upscale services.

Freeing a Python reference to a pipeline does not immediately return its VRAM to
the CUDA allocator — an explicit ``empty_cache`` is needed. ``release`` runs a GC
pass and empties the cache, best-effort (a no-op without CUDA / torch), so the
callers can guarantee headroom before loading the next model.
"""
from __future__ import annotations


def release() -> None:
    """Collect garbage and return cached VRAM to the driver (best-effort)."""
    import gc

    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:  # noqa: BLE001 - torch may be absent / CPU-only; never fatal
        pass
