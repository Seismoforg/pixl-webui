"""GPU/RAM fit assessment for a model against the current inference device.

Decides whether a model's weights fit fully into the selected GPU's VRAM, only
with CPU offloading into system RAM, or not at all. The same verdict drives both
the UI badge and the pipeline's device placement so the two never disagree.

The VRAM requirement is a heuristic: HuggingFace exposes no VRAM figure, so each
catalog entry carries a hand-tuned ``min_vram_gb`` value.
"""
from __future__ import annotations

from pydantic import BaseModel

from ..catalog import ModelInfo
from ..config import load_settings
from . import quantize

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


class QuantLevel(BaseModel):
    """One selectable load-time quantization level with its per-level VRAM estimate
    and fit verdict, for the Models-page quant selector."""

    level: str  # "fp16" | "int8" | "nf4"
    est_vram_gb: float
    verdict: str


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


# --- Primitive cores (min_vram_gb + family + approx_size_gb), reused by both the
# model catalog and the quant-capable FLUX engines. ---

def est_vram_for(min_vram_gb: float, family: str, level: str = "fp16") -> float:
    """Estimated VRAM at quantization ``level``: the fp16 ``min_vram_gb`` with the
    heavy module's share rescaled by the level's bytes/param (fp16 → unchanged;
    int8 ≈ ½ the heavy module; nf4 ≈ ¼). A heuristic, floored."""
    heavy_fp16 = quantize.heavy_module_gb_fp16(family)
    scaled = heavy_fp16 * (quantize.bytes_per_param(level) / 2.0)
    return round(max(min_vram_gb - heavy_fp16 + scaled, 0.5), 2)


def _verdict(est: float, gpu: float | None, ram: float | None) -> str:
    # The RAM/offload check uses the LOADED footprint (`est`), not the on-disk download
    # size: CPU offload streams the loaded (fp16/NF4) weights through RAM, ~= est. This
    # keeps the fit verdict independent of the (display-only) download size, so a large
    # fp32 download that loads small (Z-Image, SD 3.5) isn't wrongly flagged too_large.
    if gpu is None:
        return "cpu_only"
    if est <= gpu * _VRAM_USABLE:
        return "fits_gpu"
    if ram is not None and est <= ram * _RAM_USABLE:
        return "fits_offload"
    return "too_large"


def assess_for(min_vram_gb: float, family: str, level: str = "fp16") -> FitInfo:
    """Fit verdict from raw entry facts at load ``level`` — used for the quant-capable
    engines (which aren't ``ModelInfo``) and, via ``assess``, the model catalog."""
    est = est_vram_for(min_vram_gb, family, level)
    gpu, ram = _gpu_total_gb(), _ram_total_gb()
    return FitInfo(
        verdict=_verdict(est, gpu, ram),
        est_vram_gb=est,
        gpu_total_gb=gpu,
        ram_total_gb=ram,
    )


def quant_levels_for(min_vram_gb: float, family: str) -> list[QuantLevel]:
    """Per-level VRAM estimate + fit verdict for each quantization level. Empty when
    bitsandbytes is unavailable or the family isn't quant-capable (fp16-only)."""
    if not quantize.available() or not quantize.quantizable(family):
        return []
    gpu, ram = _gpu_total_gb(), _ram_total_gb()
    out = []
    for level in quantize.LEVELS:
        est = est_vram_for(min_vram_gb, family, level)
        out.append(QuantLevel(level=level, est_vram_gb=est, verdict=_verdict(est, gpu, ram)))
    return out


def suggest_for(min_vram_gb: float, family: str) -> str:
    """Auto-suggested load level: ``fp16`` if it fits GPU VRAM, else ``nf4``. ``int8``
    stays selectable but is NEVER auto-suggested — for diffusion its LLM.int8 kernel is
    much slower than NF4 (and casts bf16→fp16 per matmul) with no real quality gain, so
    NF4 is the sensible 16 GB default. Always ``fp16`` with no GPU or no bitsandbytes."""
    gpu = _gpu_total_gb()
    if gpu is None or not quantize.available():
        return "fp16"
    if est_vram_for(min_vram_gb, family, "fp16") <= gpu * _VRAM_USABLE:
        return "fp16"
    return "nf4"


def effective_level(slug: str, min_vram_gb: float, family: str, is_gguf: bool = False) -> str:
    """The load-time quantization level for an entry: the user's stored choice if
    valid, else the auto-suggested level. ``fp16`` for GGUF entries (self-quantized)."""
    if is_gguf or not quantize.quantizable(family):
        return "fp16"
    stored = load_settings().load_quantization.get(slug)
    if stored in quantize.LEVELS:
        return stored
    return suggest_for(min_vram_gb, family)


# --- Model-catalog wrappers over the primitives. ---

def est_vram_gb(model: ModelInfo, level: str = "fp16") -> float:
    return est_vram_for(model.min_vram_gb, model.family, level)


def assess(model: ModelInfo, level: str = "fp16") -> FitInfo:
    """Classify how ``model`` fits the current inference device at load ``level``.

    ``fits_gpu`` — the estimated VRAM need fits the GPU (with headroom).
    ``fits_offload`` — too big for VRAM, but the weights fit system RAM so the
    pipeline can stream them via CPU offloading (slower, but works).
    ``too_large`` — does not fit even with offloading.
    ``cpu_only`` — no CUDA GPU detected; everything runs on the CPU.

    ``level`` != "fp16" scales the estimate down for a bitsandbytes NF4/int8 load.
    """
    return assess_for(model.min_vram_gb, model.family, level)


def quant_levels(model: ModelInfo) -> list[QuantLevel]:
    """Per-level estimate + verdict for the Models-page selector (empty = fp16-only)."""
    return quant_levels_for(model.min_vram_gb, model.family)


def suggest_level(model: ModelInfo) -> str:
    """Highest-quality level that fits GPU VRAM for ``model`` (see ``suggest_for``)."""
    return suggest_for(model.min_vram_gb, model.family)
