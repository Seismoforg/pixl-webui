"""On-the-fly weight quantization (bitsandbytes) for non-GGUF diffusers models.

Builds the diffusers ``BitsAndBytesConfig`` for a chosen level and holds the VRAM
heuristics (bytes/param + heavy denoising-module param counts) that drive the
per-level fit badge and the Models-page quant selector. NF4 lets FLUX (and the FLUX
Fill/Kontext engines) run in ~16 GB WITH LoRAs — unlike GGUF, which blocks LoRAs.

bitsandbytes is an optional, installer-managed dependency (platform-specific, like
torch — see install.ps1). When it is absent, only ``fp16`` is available and the load
paths fall back to full precision.
"""
from __future__ import annotations

import importlib.util

# Quantization levels, ordered highest-quality → smallest VRAM. ``fp16`` = no
# quantization (the diffusers default load).
LEVELS: tuple[str, ...] = ("fp16", "int8", "nf4")

# Approx bytes per parameter of the heavy denoising module at each level (fp16 = 2).
_BYTES_PER_PARAM = {"fp16": 2.0, "int8": 1.0, "nf4": 0.5}

# Heavy denoising-module parameter counts (billions) per model family — the module
# quantization actually shrinks (transformer for FLUX/SD 3.x, UNet for SD 1.5/SDXL).
# Hand-figured from the public model cards; a heuristic like catalog ``min_vram_gb``.
_HEAVY_PARAMS_B = {
    "SD 1.5": 0.86,
    "SDXL": 2.6,
    "FLUX": 11.9,
    "SD 3.x": 8.1,
    "Z-Image": 6.0,
}

# GB occupied by one billion fp16 params (2 bytes/param, GiB): 1e9 * 2 / 1024**3.
_GB_PER_BILLION_FP16 = 2e9 / 1024**3


def available() -> bool:
    """True when bitsandbytes is importable, so int8/nf4 can actually load."""
    return importlib.util.find_spec("bitsandbytes") is not None


def quantizable(family: str) -> bool:
    """Whether on-the-fly bitsandbytes quantization applies to a family. Only the
    families with a known heavy denoising module (SD 1.5/SDXL/FLUX/SD 3.x) are
    quant-capable; others (e.g. Z-Image) load at fp16/bf16 only."""
    return family in _HEAVY_PARAMS_B


def engine_family(engine) -> str | None:
    """Model family of a quant-capable engine (the FLUX Fill / Kontext engines), or
    ``None`` for engines on-the-fly quantization doesn't apply to (Real-ESRGAN, SD/SDXL
    inpaint, or a GGUF engine that carries its own quantization). Read from the catalog
    entry (repo id / kind) so it works before download."""
    if getattr(engine, "is_gguf", False):
        return None
    kind = getattr(engine, "kind", "")
    repo = getattr(engine, "repo_id", "").lower()
    if "z-image" in repo:
        return "Z-Image"
    if kind == "edit" or "flux" in repo:
        return "FLUX"
    return None


def bytes_per_param(level: str) -> float:
    """Approx bytes/param of the heavy module at ``level`` (fp16 baseline = 2)."""
    return _BYTES_PER_PARAM.get(level, 2.0)


def heavy_module_gb_fp16(family: str) -> float:
    """Approx VRAM (GiB) the family's heavy module occupies at fp16."""
    return _HEAVY_PARAMS_B.get(family, 2.6) * _GB_PER_BILLION_FP16


def quant_config(level: str, family: str):
    """diffusers ``BitsAndBytesConfig`` for ``level``, or ``None`` for fp16 / when
    bitsandbytes is unavailable / for an unknown level.

    nf4 → 4-bit NF4 with double-quant; compute dtype bf16 for FLUX/SD 3.x (their
    trained dtype) else fp16. int8 → bitsandbytes LLM.int8 (8-bit).
    """
    if level not in ("int8", "nf4") or not available():
        return None
    import torch
    from diffusers import BitsAndBytesConfig

    if level == "int8":
        return BitsAndBytesConfig(load_in_8bit=True)
    compute = torch.bfloat16 if family in ("FLUX", "SD 3.x", "Z-Image") else torch.float16
    return BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=compute,
        bnb_4bit_use_double_quant=True,
    )
