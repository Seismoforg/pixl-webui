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

from . import callbacks, vram
from .. import config
from ..config import load_settings
from ..device import get_compute_dtype, get_torch_device
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

    pipe = _load_flux_kontext(engine)
    apply_perf(pipe, load_settings())
    with _lock:
        _pipe = pipe
        _slug = engine.slug
    return pipe


def _load_flux_kontext(engine: UpscalerInfo):
    """Build a FLUX.1 Kontext pipe from the engine's GGUF transformer.

    Only the transformer is quantized (from the local ``.gguf``); the base repo
    supplies the VAE/text encoders/scheduler. Always CPU-offloads so the T5 encoder
    streams off the GPU during denoising, keeping peak VRAM within ~16 GB."""
    from diffusers import (
        FluxKontextPipeline,
        FluxTransformer2DModel,
        GGUFQuantizationConfig,
    )

    model_path = config.model_dir(engine.slug)
    dtype = get_compute_dtype()
    transformer = FluxTransformer2DModel.from_single_file(
        str(model_path / engine.gguf_filename),
        config=str(model_path / "transformer"),
        quantization_config=GGUFQuantizationConfig(compute_dtype=dtype),
        torch_dtype=dtype,
    )
    pipe = FluxKontextPipeline.from_pretrained(
        str(model_path), transformer=transformer, torch_dtype=dtype
    )
    if get_torch_device() == "cpu":
        pipe = pipe.to("cpu")
    else:
        pipe.enable_model_cpu_offload()
    return pipe


def make_generator(seed: int | None):
    """A seeded ``torch.Generator`` on the active device for a reproducible edit,
    or None (random) when no seed is given."""
    if seed is None:
        return None
    import torch

    return torch.Generator(device=get_torch_device()).manual_seed(int(seed))


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
    result = pipe(
        prompt=prompt,
        image=img,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=generator,
        **kwargs,
    )
    return result.images[0].resize(img.size, Image.LANCZOS)
