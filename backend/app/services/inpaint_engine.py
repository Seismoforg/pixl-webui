"""Shared inpaint-engine primitives — pipeline load/cache and one inpaint pass.

Both the outpaint (border-mask) and inpaint (user-mask) services drive the same
``kind: "inpaint"`` engines: an ``AutoPipelineForInpainting`` (SD 1.x / SDXL) or a
GGUF-quantized ``FluxFillPipeline`` (FLUX.1-Fill). This module owns the single
cached inpaint pipe and the low-level ``run_inpaint`` call so the two services
share one loaded model (they never run at once) and identical engine wiring.

Coordinates with the VRAM manager: loading the inpaint pipe first frees the
generation + upscaler models.
"""
from __future__ import annotations

import threading

from . import callbacks, fit, quantize, vram
from .. import config
from ..config import load_settings
# make_generator re-exported so `inpaint_engine.make_generator` callers (inpaint,
# outpaint) keep working after the move to device.
from ..device import (
    get_compute_dtype,
    get_dtype,
    get_torch_device,
    load_gguf_pipe,
    load_quantized_pipe,
    make_generator,
    place_offloaded,
)
from .optimizations import apply_perf
from .upscalers import UpscalerInfo

# Working long-side for the composition/inpaint pass, per model family: SD 1.x
# duplicates the subject much above ~768, while SDXL is native at 1024. FLUX is
# native at 1024; keeping the cap there keeps the GGUF Fill pass within ~16 GB VRAM
# (with CPU offload) while it sees the whole frame.
SD_WORK = 768
SDXL_WORK = 1024
FLUX_WORK = 1024
# Native (minimum) working long-side per family. Diffusion models produce incoherent
# noise when run well below their training resolution, so the user-mask inpaint crop
# is scaled UP to at least this (and down to the cap above) before generating.
SD_NATIVE = 512
SDXL_NATIVE = 1024
FLUX_NATIVE = 1024
# Tuned defaults reused by both services (overridable per run).
DEFAULT_STEPS = 30
DEFAULT_GUIDANCE = 7.5
DEFAULT_REFINE_STEPS = 24
# Hires refinement pass: a short, low-strength second inpaint at full resolution.
REFINE_STRENGTH = 0.35
DEFAULT_PROMPT = "seamless natural background continuation, high detail"

_lock = threading.Lock()
_pipe = None
_slug: str | None = None


def unload() -> None:
    """Drop the cached inpaint pipe and free its VRAM."""
    global _pipe, _slug
    with _lock:
        _pipe = None
        _slug = None
    vram.release()


def is_sdxl(model_path) -> bool:
    """True if the inpaint repo is an SDXL pipeline (per its ``model_index.json``)."""
    import json

    try:
        data = json.loads((model_path / "model_index.json").read_text())
    except (OSError, ValueError):
        return False
    return "XL" in str(data.get("_class_name", ""))


def is_flux(pipe) -> bool:
    """True when the loaded pipe is a FLUX (Fill) pipeline."""
    return type(pipe).__name__.startswith("Flux")


def is_zimage(pipe) -> bool:
    """True when the loaded pipe is a Z-Image (Inpaint) pipeline. Z-Image is
    flow-matching like FLUX, so callers treat it the same (crisp mask, native
    scheduler, explicit size, no negative)."""
    return type(pipe).__name__.startswith("ZImage")


def working_cap(engine: UpscalerInfo, is_flux_pipe: bool) -> int:
    """Family working long-side cap for ``engine`` (FLUX / SDXL / SD 1.x)."""
    if is_flux_pipe:
        return FLUX_WORK
    return SDXL_WORK if is_sdxl(config.model_dir(engine.slug)) else SD_WORK


def working_native(engine: UpscalerInfo, is_flux_pipe: bool) -> int:
    """Family native (minimum) working long-side for ``engine`` — the resolution the
    inpaint crop is scaled up to so small edits don't fall below the model's training
    size (which yields noise)."""
    if is_flux_pipe:
        return FLUX_NATIVE
    return SDXL_NATIVE if is_sdxl(config.model_dir(engine.slug)) else SD_NATIVE


def load(engine: UpscalerInfo):
    """Return the cached inpaint pipe for ``engine``, loading (and freeing every
    other model) on a slug change."""
    global _pipe, _slug
    with _lock:
        if _pipe is not None and _slug == engine.slug:
            return _pipe

    # Free everything else before loading the inpaint pipe (lazy imports avoid a
    # cycle: pipeline/upscale/edit import this module too).
    from . import edit as _edit
    from . import pipeline as _pipeline
    from . import upscale as _upscale

    _pipeline.unload()
    _upscale.unload()
    _edit.unload()
    vram.release()

    model_path = config.model_dir(engine.slug)
    if engine.is_gguf:
        pipe = _load_flux_fill_gguf(engine, model_path)
    elif quantize.engine_family(engine) == "Z-Image":
        pipe = _load_zimage_inpaint(engine, model_path)
    elif quantize.engine_family(engine) == "FLUX":
        pipe = _load_flux_fill(engine, model_path)
    else:
        from diffusers import AutoPipelineForInpainting

        # Pick the pipeline class from the repo so a custom SDXL inpaint engine loads
        # as SDXL instead of being forced into the SD 1.5 class (which fails). Load
        # the engine's weight variant (curated SD 1.5 inpaint ships only fp16; custom
        # repos carry their own detected variant).
        kwargs: dict = {"torch_dtype": get_dtype(), "variant": engine.variant}
        # SD 1.x/2.x inpaint pipelines ship a safety checker whose weights we don't
        # fetch, so skip it. SDXL has no safety checker — those kwargs are invalid.
        if not is_sdxl(model_path):
            kwargs["safety_checker"] = None
            kwargs["requires_safety_checker"] = False
        pipe = AutoPipelineForInpainting.from_pretrained(str(model_path), **kwargs)
        pipe = place_offloaded(pipe)

    # attention slicing (+ VAE/xformers) is applied here purely from the settings.
    apply_perf(pipe, load_settings())
    with _lock:
        _pipe = pipe
        _slug = engine.slug
    return pipe


def _load_flux_fill_gguf(engine: UpscalerInfo, model_path):
    """Build a FLUX.1-Fill inpaint pipe from the engine's GGUF transformer (shared
    GGUF load path). Only the transformer is quantized; the base repo supplies the
    VAE/text encoders/scheduler. CPU-offloaded to keep peak VRAM within ~16 GB."""
    from diffusers import FluxFillPipeline, FluxTransformer2DModel

    return load_gguf_pipe(model_path, engine.gguf_filename, FluxTransformer2DModel, FluxFillPipeline)


def _load_flux_fill(engine: UpscalerInfo, model_path):
    """Build a FLUX.1-Fill inpaint pipe from the fp16 repo, quantized on the fly
    (NF4/int8) per the engine's effective level, else full fp16. Transformer
    quantized, CPU-offloaded (bounds VRAM; ~16 GB at NF4). LoRA-compatible unlike GGUF."""
    from diffusers import FluxFillPipeline, FluxTransformer2DModel

    level = fit.effective_level(engine.slug, engine.min_vram_gb, "FLUX")
    quant_cfg = quantize.quant_config(level, "FLUX") if level != "fp16" else None
    if quant_cfg is not None:
        return load_quantized_pipe(
            model_path, FluxTransformer2DModel, FluxFillPipeline, quant_cfg,
            component="transformer", family="FLUX", variant=engine.variant,
        )
    pipe = FluxFillPipeline.from_pretrained(
        str(model_path), torch_dtype=get_compute_dtype(),
        variant=engine.variant, use_safetensors=engine.use_safetensors,
    )
    return place_offloaded(pipe)


def _load_zimage_inpaint(engine: UpscalerInfo, model_path):
    """Build a Z-Image inpaint/outpaint pipe from the shared Z-Image weights. NF4
    shrinks the transformer so the pipe fits 16 GB resident (no offload shuffle);
    fp16 keeps bf16. Placed by the fit verdict — resident when it fits, else offload."""
    from diffusers import ZImageInpaintPipeline, ZImageTransformer2DModel

    dtype = get_compute_dtype()
    level = fit.effective_level(engine.slug, engine.min_vram_gb, "Z-Image")
    quant_cfg = quantize.quant_config(level, "Z-Image") if level != "fp16" else None
    if quant_cfg is not None:
        transformer = ZImageTransformer2DModel.from_pretrained(
            str(model_path), subfolder="transformer", quantization_config=quant_cfg, torch_dtype=dtype
        )
        pipe = ZImageInpaintPipeline.from_pretrained(
            str(model_path), transformer=transformer, torch_dtype=dtype
        )
    else:
        pipe = ZImageInpaintPipeline.from_pretrained(
            str(model_path), torch_dtype=dtype, use_safetensors=engine.use_safetensors
        )
    fits_gpu = (
        get_torch_device() == "cuda"
        and fit.assess_for(engine.min_vram_gb, "Z-Image", engine.approx_size_gb, level).verdict
        == "fits_gpu"
    )
    if get_torch_device() == "cpu" or fits_gpu:
        return pipe.to(get_torch_device())
    return place_offloaded(pipe)


def effective_negative(negative: str) -> str:
    """The built-in configurable negative base with the per-run negative appended."""
    return ", ".join(
        part for part in (load_settings().outpaint_negative, negative) if part.strip()
    )


def run_inpaint(
    pipe, image, mask, prompt: str, negative: str, report, tile_index: int, tile_total: int,
    *, steps: int = DEFAULT_STEPS, strength: float | None = None,
    guidance: float = DEFAULT_GUIDANCE, generator=None, is_flux_pipe: bool = False,
    phase: str = "inpainting",
):
    """Run one inpaint pass, reporting step progress under ``phase``.
    ``strength`` < 1 turns it into a hires refinement pass; diffusers then runs a
    strength-reduced number of denoising steps. The reported total comes from the
    pipeline's own ``_num_timesteps`` (set right before the denoising loop) so it
    matches diffusers' console exactly, rather than a pre-truncated estimate.
    For ``is_flux_pipe`` (FLUX Fill) the guidance-distilled pipe takes no negative
    prompt and wants an explicit canvas size."""
    timer = callbacks.StepTimer()
    # Pre-loop estimate, only used for the initial on_step(0) before the pipe has
    # set _num_timesteps for this call.
    est = steps if strength is None else max(1, int(steps * strength))

    def on_step(done: int) -> None:
        # Once denoising starts, trust the pipeline's real timestep count.
        actual = getattr(pipe, "_num_timesteps", None) if done >= 1 else None
        total = actual or est
        completed = min(done, total)
        report({
            "phase": phase,
            "current_tile": tile_index,
            "total_tiles": tile_total,
            "current_step": completed,
            "total_steps": total,
            "its": timer.its(completed),
        })

    on_step(0)
    kwargs = callbacks.step_kwargs(pipe, on_step)
    if strength is not None:
        kwargs["strength"] = strength
    if is_flux_pipe:
        kwargs["height"] = image.height
        kwargs["width"] = image.width
    else:
        kwargs["negative_prompt"] = negative
    call_kwargs = dict(
        prompt=prompt or DEFAULT_PROMPT,
        image=image,
        mask_image=mask,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=generator,
        **kwargs,
    )
    # Real FLUX Fill is CPU-offloaded → its inline VAE decode is starved of VRAM by the
    # resident quantized transformer (slow). Decode via output_type="latent" so the
    # pipeline offloads the transformer first, then decode with the GPU free (see
    # pipeline._decode_flux_latents). Z-Image (is_flux_pipe via the combined flag) is
    # resident, so it keeps the inline path.
    if is_flux(pipe):
        from . import pipeline as _pipeline

        latents = pipe(**call_kwargs, output_type="latent").images
        img = _pipeline._decode_flux_latents(pipe, latents, image.width, image.height)
    else:
        img = pipe(**call_kwargs).images[0]
    return img.resize(image.size)
