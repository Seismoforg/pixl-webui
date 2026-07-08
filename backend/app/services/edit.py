"""Prompt-based image editing service (FLUX.1 Kontext).

FLUX.1 Kontext edits an image from a natural-language instruction ("change the
lighting to a night scene") while preserving the composition — a whole-image edit
with NO mask, unlike the inpaint/outpaint pipes. It is a distinct diffusers
pipeline (``FluxKontextPipeline``) loaded from the engine's GGUF-quantized
transformer, so this service owns its own cached pipe and coordinates VRAM with the
other model services, mirroring the inpaint-engine load pattern.

Coordinates with the VRAM manager: loading the Kontext pipe first frees the
generation, upscaler and inpaint models so only this task's model sits in VRAM.
"""
from __future__ import annotations

import threading

from . import callbacks, fit, loras as loras_svc, model_slots, quantize, vram
from .. import config
from ..config import load_settings
from ..device import (
    get_torch_device,
    load_flux2_pipe,
    load_flux_engine_pipe,
    load_gguf_pipe,
    make_generator,
)
from .optimizations import apply_perf
from .upscalers import UpscalerInfo

# Tuned defaults reused by the router (overridable per run). Kontext is
# guidance-distilled — its real guidance is low (~2.5), unlike FLUX Fill (~30).
DEFAULT_STEPS = 28
DEFAULT_GUIDANCE = 2.5

_lock = threading.Lock()
_pipe = None
_slug: str | None = None
# LoRA adapters loaded on the current edit pipe: adapter_name (== lora slug) -> weight.
# Compared against a run's request to skip a redundant reload. Reset on pipe rebuild.
_loaded_loras: dict[str, float] = {}


def unload() -> None:
    """Drop the cached Kontext pipe and free its VRAM."""
    global _pipe, _slug
    with _lock:
        _pipe = None
        _slug = None
    _loaded_loras.clear()
    vram.release()


model_slots.register("edit", unload)


def load(engine: UpscalerInfo):
    """Return the cached Kontext pipe for ``engine``, loading (and freeing every
    other model) on a slug change."""
    global _pipe, _slug
    with _lock:
        if _pipe is not None and _slug == engine.slug:
            return _pipe

    # Free every other resident model before loading (registry).
    model_slots.acquire("edit")

    if quantize.engine_family(engine) == "FLUX.2":
        pipe = _load_flux2_edit(engine)
    elif engine.is_gguf:
        pipe = _load_flux_kontext_gguf(engine)
    else:
        pipe = _load_flux_kontext(engine)
    apply_perf(pipe, load_settings())
    with _lock:
        _pipe = pipe
        _slug = engine.slug
    _loaded_loras.clear()  # fresh pipe carries no adapters
    return pipe


def _apply_edit_loras(pipe, engine: UpscalerInfo, requested: list[tuple[str, float]]) -> None:
    """Blend the requested ``(slug, weight)`` LoRAs onto the edit pipe via the shared
    ``loras.apply_lora_set`` core (family = the engine's FLUX / FLUX.2)."""
    loras_svc.apply_lora_set(
        pipe, quantize.engine_family(engine), engine.is_gguf, requested, _loaded_loras
    )


def _load_flux_kontext_gguf(engine: UpscalerInfo):
    """Build a FLUX.1 Kontext pipe from the engine's GGUF transformer (shared GGUF
    load path). Only the transformer is quantized; the base repo supplies the
    VAE/text encoders/scheduler. CPU-offloaded to keep peak VRAM within ~16 GB."""
    from diffusers import FluxKontextPipeline, FluxTransformer2DModel

    model_path = config.model_dir(engine.slug)
    return load_gguf_pipe(model_path, engine.gguf_filename, FluxTransformer2DModel, FluxKontextPipeline)


def _load_flux_kontext(engine: UpscalerInfo):
    """Build a FLUX.1 Kontext pipe via the shared FLUX-engine loader (NF4/int8 per
    the engine's effective level, else fp16; CPU-offloaded either way)."""
    from diffusers import FluxKontextPipeline, FluxTransformer2DModel

    level = fit.effective_level(engine.slug, engine.min_vram_gb, "FLUX")
    quant_cfg = quantize.quant_config(level, "FLUX") if level != "fp16" else None
    return load_flux_engine_pipe(
        config.model_dir(engine.slug), FluxTransformer2DModel, FluxKontextPipeline,
        quant_cfg, variant=engine.variant, use_safetensors=engine.use_safetensors,
    )


def _load_flux2_edit(engine: UpscalerInfo):
    """Build a FLUX.2 [klein] edit pipe (``Flux2KleinPipeline``, native img2img). At
    NF4 both the transformer and the 8B Qwen3 text encoder are quantized (dual-module)
    so the 9B fits ~16 GB; placed by the fit verdict (resident when it fits). Reuses the
    generation weights (same slug), so no extra download."""
    model_path = config.model_dir(engine.slug)
    level = fit.effective_level(engine.slug, engine.min_vram_gb, "FLUX.2")
    quant_cfg = quantize.flux2_quant_config(level) if level != "fp16" else None
    fits_gpu = (
        get_torch_device() == "cuda"
        and fit.assess_for(engine.min_vram_gb, "FLUX.2", level).verdict == "fits_gpu"
    )
    return load_flux2_pipe(model_path, quant_cfg, fits_gpu)


def edit_image(
    image, prompt: str, report, engine: UpscalerInfo,
    *, steps: int = DEFAULT_STEPS, guidance: float = DEFAULT_GUIDANCE,
    seed: int | None = None, loras: list[tuple[str, float]] | None = None,
):
    """Edit ``image`` per the instruction ``prompt`` with ``engine`` (FLUX / FLUX.2).

    ``report`` gets the shared upscale/reframe progress dict (phase ``"editing"``).
    The pipe auto-resizes the input to its preferred ~1 MP resolution internally
    (bounding VRAM), so the full-res source is passed directly and the result is
    scaled back to the source dimensions. ``loras`` blends the given ``(slug, weight)``
    adapters onto the edit pipe (family-matched, downloaded). Returns a new PIL image."""
    from PIL import Image

    report({"phase": "loading"})
    img = image.convert("RGB")

    pipe = load(engine)
    _apply_edit_loras(pipe, engine, loras or [])
    generator = make_generator(seed)
    timer = callbacks.StepTimer()

    def on_step(done: int) -> None:
        # Once denoising starts, trust the pipeline's real timestep count.
        actual = getattr(pipe, "_num_timesteps", None) if done >= 1 else None
        total = actual or steps
        completed = min(done, total)
        report({
            "phase": "editing",
            "current_tile": 1,
            "total_tiles": 1,
            "current_step": completed,
            "total_steps": total,
            "its": timer.its(completed),
        })

    on_step(0)
    kwargs = callbacks.step_kwargs(pipe, on_step)
    # FLUX Kontext is CPU-offloaded → its inline VAE decode is starved of VRAM by the
    # resident quantized transformer (slow). Pass an explicit ~1 MP size (so the latent
    # grid is known) and decode via output_type="latent": the pipeline offloads the
    # transformer first, then we decode with the GPU free (pipeline._decode_flux_latents).
    import math

    from .pipeline import decode_flux_latents

    w0, h0 = img.size
    ar = w0 / h0
    height = max(16, round(math.sqrt((1024 * 1024) / ar) / 16) * 16)
    width = max(16, round(math.sqrt((1024 * 1024) * ar) / 16) * 16)
    call_kwargs = dict(
        prompt=prompt,
        image=img,
        height=height,
        width=width,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=generator,
        **kwargs,
    )
    # FLUX.2 [klein] is resident (dual-NF4) and uses its own latent packing, so it
    # decodes inline. FLUX.1 Kontext is CPU-offloaded → decode via output_type="latent"
    # so the pipeline offloads the transformer first, then _decode_flux_latents runs with
    # the GPU free (the inline decode is pathologically slow under offload).
    if type(pipe).__name__.startswith("Flux2"):
        result = pipe(**call_kwargs).images[0]
    else:
        latents = pipe(**call_kwargs, output_type="latent").images
        result = decode_flux_latents(pipe, latents, width, height)
    return result.resize(img.size, Image.LANCZOS)
