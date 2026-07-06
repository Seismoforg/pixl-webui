"""Sampler (diffusers scheduler) registry and application.

Exposes a curated set of samplers mirroring the common Automatic1111 names and
maps each to a diffusers scheduler class plus the config flags that reproduce it
(Karras sigmas, SDE algorithm variants, …). ``apply_sampler`` swaps the
pipeline's scheduler in place — but only when the target class is compatible with
the loaded model. UNet models (SD 1.5, SDXL, SD 2) accept the classic schedulers;
flow-matching models (FLUX, SD 3.x) do not, so for them the chosen sampler is
silently ignored and the model's native scheduler is kept.
"""
from __future__ import annotations

from pydantic import BaseModel

# The recommended default: deterministic (non-ancestral, so reproducible with a
# fixed seed), converges cleanly at ~20-30 steps, and the de-facto community
# default across A1111/Forge.
DEFAULT_SAMPLER = "dpmpp_2m_karras"

# Sentinel meaning "keep the pipeline's own scheduler" (used for flow-matching
# models and whenever a requested sampler turns out to be incompatible).
NATIVE = "default"


class Sampler(BaseModel):
    id: str
    label: str


# id -> (label, diffusers class name, from_config overrides). Order is the UI order.
_REGISTRY: list[tuple[str, str, str, dict]] = [
    (NATIVE, "Default (model)", "", {}),
    ("euler", "Euler", "EulerDiscreteScheduler", {}),
    ("euler_a", "Euler a", "EulerAncestralDiscreteScheduler", {}),
    ("heun", "Heun", "HeunDiscreteScheduler", {}),
    ("lms", "LMS", "LMSDiscreteScheduler", {}),
    ("dpm2", "DPM2", "KDPM2DiscreteScheduler", {}),
    ("dpm2_a", "DPM2 a", "KDPM2AncestralDiscreteScheduler", {}),
    ("dpmpp_2m", "DPM++ 2M", "DPMSolverMultistepScheduler",
     {"algorithm_type": "dpmsolver++"}),
    ("dpmpp_2m_karras", "DPM++ 2M Karras", "DPMSolverMultistepScheduler",
     {"algorithm_type": "dpmsolver++", "use_karras_sigmas": True}),
    ("dpmpp_2m_sde", "DPM++ 2M SDE", "DPMSolverMultistepScheduler",
     {"algorithm_type": "sde-dpmsolver++"}),
    ("dpmpp_2m_sde_karras", "DPM++ 2M SDE Karras", "DPMSolverMultistepScheduler",
     {"algorithm_type": "sde-dpmsolver++", "use_karras_sigmas": True}),
    ("dpmpp_sde", "DPM++ SDE", "DPMSolverSinglestepScheduler", {}),
    ("dpmpp_sde_karras", "DPM++ SDE Karras", "DPMSolverSinglestepScheduler",
     {"use_karras_sigmas": True}),
    ("unipc", "UniPC", "UniPCMultistepScheduler", {}),
    ("ddim", "DDIM", "DDIMScheduler", {}),
    # LCM: pair with an LCM-LoRA for few-step (~4-8) generation at low guidance (~1).
    # Not advertised in a pipe's `compatibles`, so apply_sampler special-cases it.
    ("lcm", "LCM", "LCMScheduler", {}),
]

_BY_ID = {entry[0]: entry for entry in _REGISTRY}


def list_samplers() -> list[Sampler]:
    """Return the curated sampler list in UI order."""
    return [Sampler(id=i, label=label) for i, label, _cls, _cfg in _REGISTRY]


def apply_sampler(pipe, sampler_id: str) -> str:
    """Swap ``pipe.scheduler`` to the requested sampler, in place.

    Returns the *effective* sampler id actually applied. The chosen sampler is
    applied only if its scheduler class is drop-in compatible with the loaded
    model (``pipe.scheduler.compatibles``); otherwise the pipeline keeps its own
    scheduler and ``"default"`` is returned. This keeps flow-matching models
    (FLUX, SD 3.x) working without any special-casing.
    """
    entry = _BY_ID.get(sampler_id)
    if entry is None or entry[0] == NATIVE:
        return NATIVE

    _id, _label, cls_name, config = entry

    import diffusers

    target_cls = getattr(diffusers, cls_name, None)
    if target_cls is None:
        return NATIVE

    # ``compatibles`` is the list of scheduler classes valid for this model.
    if target_cls not in getattr(pipe.scheduler, "compatibles", []):
        # LCM isn't advertised in `compatibles` but is valid on UNet models (SD 1.5/
        # SDXL) — the standard LCM-LoRA recipe swaps in LCMScheduler. Allow it there
        # (identified by a `.unet`); still block on flow-matching models (FLUX/SD 3.x,
        # which expose `.transformer`), which keep their native sampler.
        if sampler_id == "lcm" and getattr(pipe, "unet", None) is not None:
            pass
        else:
            return NATIVE

    pipe.scheduler = target_cls.from_config(pipe.scheduler.config, **config)
    return sampler_id
