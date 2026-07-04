"""GPU/RAM fit assessment for a model against the current inference device.

Decides whether a model's weights fit fully into the selected GPU's VRAM, only
with CPU offloading into system RAM, or not at all. The same verdict drives both
the UI badge and the pipeline's device placement so the two never disagree.

The VRAM requirement is a heuristic: HuggingFace exposes no VRAM figure, so custom
models estimate it from download size (see ``hf_browse.estimate_min_vram_gb``)
and curated models carry a hand-tuned value.
"""
from __future__ import annotations

from pydantic import BaseModel

from ..catalog import ModelInfo

_GB = 1024**3

# Fractions of physical memory treated as usable for a model, leaving headroom
# for activations, the OS and other processes.
_VRAM_USABLE = 0.9
_RAM_USABLE = 0.7


class FitInfo(BaseModel):
    verdict: str  # "fits_gpu" | "fits_offload" | "too_large" | "cpu_only"
    est_vram_gb: float
    gpu_total_gb: float | None = None
    ram_total_gb: float | None = None


def _gpu_total_gb() -> float | None:
    try:
        import torch
    except ImportError:
        return None
    if not torch.cuda.is_available():
        return None
    _, total = torch.cuda.mem_get_info()
    return round(total / _GB, 2)


def _ram_total_gb() -> float | None:
    try:
        import psutil
    except ImportError:
        return None
    return round(psutil.virtual_memory().total / _GB, 2)


def assess(model: ModelInfo) -> FitInfo:
    """Classify how ``model`` fits the current inference device.

    ``fits_gpu`` — the estimated VRAM need fits the GPU (with headroom).
    ``fits_offload`` — too big for VRAM, but the weights fit system RAM so the
    pipeline can stream them via CPU offloading (slower, but works).
    ``too_large`` — does not fit even with offloading.
    ``cpu_only`` — no CUDA GPU detected; everything runs on the CPU.
    """
    est = model.min_vram_gb
    gpu = _gpu_total_gb()
    ram = _ram_total_gb()

    if gpu is None:
        verdict = "cpu_only"
    elif est <= gpu * _VRAM_USABLE:
        verdict = "fits_gpu"
    elif ram is not None and model.approx_size_gb <= ram * _RAM_USABLE:
        verdict = "fits_offload"
    else:
        verdict = "too_large"

    return FitInfo(verdict=verdict, est_vram_gb=est, gpu_total_gb=gpu, ram_total_gb=ram)
