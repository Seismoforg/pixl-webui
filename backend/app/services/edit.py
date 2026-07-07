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

from . import callbacks, fit, quantize, vram
from .. import config
from ..config import load_settings
from ..device import (
    get_compute_dtype,
    load_gguf_pipe,
    load_quantized_pipe,
    make_generator,
    place_offloaded,
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


def unload() -> None:
    """Drop the cached Kontext pipe and free its VRAM."""
    global _pipe, _slug
    with _lock:
        _pipe = None
        _slug = None
    vram.release()


def load(engine: UpscalerInfo):
    """Return the cached Kontext pipe for ``engine``, loading (and freeing every
    other model) on a slug change."""
    global _pipe, _slug
    with _lock:
        if _pipe is not None and _slug == engine.slug:
            return _pipe

    # Free every other resident model before loading (lazy imports avoid the
    # cross-service import cycle: pipeline/upscale/inpaint_engine import this too).
    from . import inpaint_engine as _inpaint_engine
    from . import pipeline as _pipeline
    from . import upscale as _upscale

    _pipeline.unload()
    _upscale.unload()
    _inpaint_engine.unload()
    vram.release()

    pipe = _load_flux_kontext_gguf(engine) if engine.is_gguf else _load_flux_kontext(engine)
    apply_perf(pipe, load_settings())
    with _lock:
        _pipe = pipe
        _slug = engine.slug
    return pipe


def _load_flux_kontext_gguf(engine: UpscalerInfo):
    """Build a FLUX.1 Kontext pipe from the engine's GGUF transformer (shared GGUF
    load path). Only the transformer is quantized; the base repo supplies the
    VAE/text encoders/scheduler. CPU-offloaded to keep peak VRAM within ~16 GB."""
    from diffusers import FluxKontextPipeline, FluxTransformer2DModel

    model_path = config.model_dir(engine.slug)
    return load_gguf_pipe(model_path, engine.gguf_filename, FluxTransformer2DModel, FluxKontextPipeline)


def _load_flux_kontext(engine: UpscalerInfo):
    """Build a FLUX.1 Kontext pipe from the fp16 repo, quantized on the fly (NF4/int8)
    per the engine's effective level, else full fp16. Transformer quantized, CPU-
    offloaded (bounds VRAM; ~16 GB at NF4)."""
    from diffusers import FluxKontextPipeline, FluxTransformer2DModel

    model_path = config.model_dir(engine.slug)
    level = fit.effective_level(engine.slug, engine.min_vram_gb, "FLUX")
    quant_cfg = quantize.quant_config(level, "FLUX") if level != "fp16" else None
    if quant_cfg is not None:
        return load_quantized_pipe(
            model_path, FluxTransformer2DModel, FluxKontextPipeline, quant_cfg,
            component="transformer", family="FLUX", variant=engine.variant,
        )
    pipe = FluxKontextPipeline.from_pretrained(
        str(model_path), torch_dtype=get_compute_dtype(),
        variant=engine.variant, use_safetensors=engine.use_safetensors,
    )
    return place_offloaded(pipe)


def edit_image(
    image, prompt: str, report, engine: UpscalerInfo,
    *, steps: int = DEFAULT_STEPS, guidance: float = DEFAULT_GUIDANCE,
    seed: int | None = None,
):
    """Edit ``image`` per the instruction ``prompt`` with ``engine`` (FLUX Kontext).

    ``report`` gets the shared upscale/reframe progress dict (phase ``"editing"``).
    Kontext auto-resizes the input to its preferred ~1 MP resolution internally
    (bounding VRAM), so the full-res source is passed directly and the result is
    scaled back to the source dimensions. Returns a new PIL image."""
    from PIL import Image

    report({"phase": "loading"})
    img = image.convert("RGB")

    pipe = load(engine)
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

    from . import pipeline as _pipeline

    w0, h0 = img.size
    ar = w0 / h0
    height = max(16, round(math.sqrt((1024 * 1024) / ar) / 16) * 16)
    width = max(16, round(math.sqrt((1024 * 1024) * ar) / 16) * 16)
    latents = pipe(
        prompt=prompt,
        image=img,
        height=height,
        width=width,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=generator,
        output_type="latent",
        **kwargs,
    ).images
    result = _pipeline._decode_flux_latents(pipe, latents, width, height)
    return result.resize(img.size, Image.LANCZOS)
