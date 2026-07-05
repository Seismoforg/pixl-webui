"""Outpainting service — extends an image to a target aspect ratio by generating
plausible content in the newly-added regions with a Stable Diffusion inpaint pipe.

**Whole-canvas composition — source preserved at full resolution.** Generation
resolution and source preservation are decoupled: the composition inpaint runs at
a model-family working cap (whole canvas in ONE pass, so the model continues the
image coherently without duplicating the subject), but only to invent the new
border. When the full canvas already fits under the cap it is generated directly
(no upscale). Otherwise the composition is upscaled to the full canvas and a short,
low-strength **hires refinement pass** re-adds full-resolution detail over the same
border, so the AI border isn't merely interpolated up. The pristine full-res source
is then composited back over its region with a feathered seam, so the source never
round-trips at low resolution and its pixels stay pixel-exact. (Independent per-tile
outpainting was tried and removed — each tile hallucinated its own subject instead
of extending the background.)

Coordinates with the VRAM manager: loading the inpaint pipe first frees the
generation + upscaler models.
"""
from __future__ import annotations

import threading

from . import callbacks, reframe, vram
from .. import config, samplers
from ..config import load_settings
from ..device import get_compute_dtype, get_dtype, get_torch_device
from .optimizations import apply_perf
from .upscalers import UpscalerInfo

_STEPS = 30
_GUIDANCE = 7.5
# Working long-side for the composition pass, per model family: SD 1.x duplicates
# the subject much above ~768, while SDXL is native at 1024. The full canvas is
# generated directly when it fits under the cap; larger canvases are generated at
# the cap and then hires-refined (below) so the border isn't just interpolated up.
_SD_WORK = 768
_SDXL_WORK = 1024
# FLUX is native at 1024; keep the working cap there so the GGUF Fill pass stays
# within ~16 GB VRAM (with CPU offload) while seeing the whole frame.
_FLUX_WORK = 1024
# Hires refinement pass: a short, low-strength second inpaint at full canvas
# resolution that restores detail the upscaled composition border loses.
_REFINE_STEPS = 24
_REFINE_STRENGTH = 0.35
_DEFAULT_PROMPT = "seamless natural background continuation, high detail"

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


def _is_sdxl(model_path) -> bool:
    """True if the inpaint repo is an SDXL pipeline (per its ``model_index.json``)."""
    import json

    try:
        data = json.loads((model_path / "model_index.json").read_text())
    except (OSError, ValueError):
        return False
    return "XL" in str(data.get("_class_name", ""))


def _load(engine: UpscalerInfo):
    global _pipe, _slug
    with _lock:
        if _pipe is not None and _slug == engine.slug:
            return _pipe

    # Free everything else before loading the inpaint pipe (lazy imports avoid a
    # cycle: pipeline/upscale import outpaint too).
    from . import pipeline as _pipeline
    from . import upscale as _upscale

    _pipeline.unload()
    _upscale.unload()
    vram.release()

    model_path = config.model_dir(engine.slug)
    if engine.is_gguf:
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
        if not _is_sdxl(model_path):
            kwargs["safety_checker"] = None
            kwargs["requires_safety_checker"] = False
        pipe = AutoPipelineForInpainting.from_pretrained(str(model_path), **kwargs)
        if get_torch_device() == "cpu":
            pipe = pipe.to("cpu")
        else:
            pipe.enable_model_cpu_offload()
        pipe.enable_attention_slicing()

    apply_perf(pipe, load_settings())
    with _lock:
        _pipe = pipe
        _slug = engine.slug
    return pipe


def _load_flux_fill(engine: UpscalerInfo, model_path):
    """Build a FLUX.1-Fill inpaint pipe from the engine's GGUF transformer.

    Only the transformer is quantized (from the local ``.gguf``); the base repo
    supplies the VAE/text encoders/scheduler. Always CPU-offloads so the T5 encoder
    streams off the GPU during denoising, keeping peak VRAM within ~16 GB."""
    from diffusers import FluxFillPipeline, FluxTransformer2DModel, GGUFQuantizationConfig

    dtype = get_compute_dtype()
    transformer = FluxTransformer2DModel.from_single_file(
        str(model_path / engine.gguf_filename),
        config=str(model_path / "transformer"),
        quantization_config=GGUFQuantizationConfig(compute_dtype=dtype),
        torch_dtype=dtype,
    )
    pipe = FluxFillPipeline.from_pretrained(
        str(model_path), transformer=transformer, torch_dtype=dtype
    )
    if get_torch_device() == "cpu":
        pipe = pipe.to("cpu")
    else:
        pipe.enable_model_cpu_offload()
    return pipe


def _make_generator(seed: int | None):
    """A seeded ``torch.Generator`` on the active device for reproducible borders,
    or None (random) when no seed is given."""
    if seed is None:
        return None
    import torch

    return torch.Generator(device=get_torch_device()).manual_seed(int(seed))


def _inpaint(
    pipe, image, mask, prompt: str, negative: str, report, tile_index: int, tile_total: int,
    steps: int = _STEPS, strength: float | None = None,
    guidance: float = _GUIDANCE, generator=None, is_flux: bool = False,
):
    """Run one inpaint pass, reporting step progress under the 'outpainting' phase.
    ``strength`` < 1 turns it into a hires refinement pass; diffusers then runs a
    strength-reduced number of denoising steps. The reported total comes from the
    pipeline's own ``_num_timesteps`` (set right before the denoising loop) so it
    matches diffusers' console exactly, rather than a pre-truncated estimate.
    For ``is_flux`` (FLUX Fill) the guidance-distilled pipe takes no negative prompt
    and wants an explicit canvas size."""
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
            "phase": "outpainting",
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
    if is_flux:
        kwargs["height"] = image.height
        kwargs["width"] = image.width
    else:
        kwargs["negative_prompt"] = negative
    result = pipe(
        prompt=prompt or _DEFAULT_PROMPT,
        image=image,
        mask_image=mask,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=generator,
        **kwargs,
    )
    return result.images[0].resize(image.size)


def _effective_negative(negative: str) -> str:
    """The built-in configurable negative base with the per-run negative appended."""
    return ", ".join(part for part in (load_settings().outpaint_negative, negative) if part.strip())


def reframe_image(
    image, ratio: tuple[float, float], prompt: str, report, engine: UpscalerInfo,
    *, mask_softness: float = 0.5, seam_softness: float = 0.5, seed_softness: float = 0.5,
    pos_x: float = 0.5, pos_y: float = 0.5, negative: str = "",
    steps: int = _STEPS, refine_steps: int = _REFINE_STEPS, guidance: float = _GUIDANCE,
    sampler: str | None = None, seed: int | None = None,
):
    """Reframe ``image`` to ``ratio`` by outpainting the new area in a single
    whole-canvas pass with the ``engine`` inpaint model. ``report`` gets the same
    progress dict shape as upscaling. The three ``*_softness`` knobs (0..1, 0.5 =
    tuned default) scale the outpaint mask gradient band, the composite-back seam
    fade, and the reflected-seed blur respectively. ``pos_x``/``pos_y`` (0..1, 0.5 =
    centre) place the source within the extended canvas. ``negative`` is the per-run
    outpaint negative prompt, appended to the configurable Settings default.
    ``steps``/``refine_steps`` are the composition and hires-refinement step counts,
    ``guidance`` the CFG scale, ``sampler`` an optional scheduler id (applied when
    supported), and ``seed`` an optional generator seed for a reproducible border."""
    report({"phase": "loading"})
    pipe = _load(engine)
    is_flux = type(pipe).__name__.startswith("Flux")
    if sampler and not is_flux:
        samplers.apply_sampler(pipe, sampler)
    if is_flux:
        cap = _FLUX_WORK
    else:
        cap = _SDXL_WORK if _is_sdxl(config.model_dir(engine.slug)) else _SD_WORK
    return _reframe_single(
        pipe, image.convert("RGB"), ratio, prompt, _effective_negative(negative), report, cap,
        mask_softness, seam_softness, seed_softness, pos_x, pos_y,
        steps, refine_steps, guidance, _make_generator(seed), is_flux,
    )


def _reframe_single(pipe, img, ratio, prompt, negative, report, cap,
                    mask_softness=0.5, seam_softness=0.5, seed_softness=0.5,
                    pos_x=0.5, pos_y=0.5,
                    steps=_STEPS, refine_steps=_REFINE_STEPS, guidance=_GUIDANCE,
                    generator=None, is_flux=False):
    from PIL import Image, ImageFilter

    rw, rh = ratio
    sw, sh = img.size

    # Full-resolution target canvas: extend ONE axis so the source is contained at
    # its native size and never shrunk (its pixels stay exact after composite-back).
    cw_full, ch_full = reframe.extend_size(sw, sh, rw, rh)
    cw_full, ch_full = reframe.round8(cw_full), reframe.round8(ch_full)
    ox_full, oy_full = reframe.place_offset(cw_full, ch_full, sw, sh, pos_x, pos_y)

    # Composition pass at the family cap: the full canvas directly when it already
    # fits (scale == 1 → no upscale, so the border stays sharp), else scaled down to
    # the cap so the model still sees the whole frame in its native range (avoids a
    # duplicate subject). Whatever is lost to that downscale is restored by the
    # hires refinement pass below.
    scale = min(1.0, cap / max(cw_full, ch_full))
    two_pass = scale < 1.0
    cw, ch = reframe.round8(round(cw_full * scale)), reframe.round8(round(ch_full * scale))
    nw, nh = max(8, round(sw * scale)), max(8, round(sh * scale))
    ox, oy = reframe.place_offset(cw, ch, nw, nh, pos_x, pos_y)
    src = img.resize((nw, nh), Image.LANCZOS)

    # Seed the border by reflecting the source outward (a boundary-consistent start
    # that matches the edge, unlike a blurred whole-image copy), softened with a
    # blur so the inpaint sees a gradient rather than a hard mirror line; then paste
    # the (scaled) source. mask = the (wide-feathered) border. All three widths are
    # user-scalable via the *_softness knobs (0.5 = tuned default).
    seed_blur = reframe.scale_softness(reframe.default_seed_blur(cw, ch), seed_softness)
    canvas = reframe.reflect_fill(src, (cw, ch), (ox, oy))
    if seed_blur > 0:
        canvas = canvas.filter(ImageFilter.GaussianBlur(seed_blur))
    canvas.paste(src, (ox, oy))
    mask = reframe.build_mask(
        (cw, ch), (ox, oy, nw, nh),
        feather=reframe.scale_softness(reframe.default_mask_feather(cw, ch), mask_softness),
    )
    gen = _inpaint(pipe, canvas, mask, prompt, negative, report, 1, 2 if two_pass else 1,
                   steps=steps, guidance=guidance, generator=generator, is_flux=is_flux)

    keep = reframe.feathered_keep_mask(
        (sw, sh),
        feather=reframe.scale_softness(reframe.default_keep_feather(sw, sh), seam_softness),
    )
    if not two_pass:
        # Generated at full resolution already — just composite the pristine source
        # back with a feathered seam so only the border is AI content.
        gen.paste(img, (ox_full, oy_full), keep)
        return gen

    # Upscale the low-res composition to full canvas (soft), then a low-strength
    # inpaint over the same border re-adds full-resolution detail before the
    # pristine full-res source is composited back pixel-exact.
    result = gen.resize((cw_full, ch_full), Image.LANCZOS)
    full_mask = reframe.build_mask(
        (cw_full, ch_full), (ox_full, oy_full, sw, sh),
        feather=reframe.scale_softness(reframe.default_mask_feather(cw_full, ch_full), mask_softness),
    )
    result = _inpaint(
        pipe, result, full_mask, prompt, negative, report, 2, 2,
        steps=refine_steps, strength=_REFINE_STRENGTH,
        guidance=guidance, generator=generator, is_flux=is_flux,
    )
    result.paste(img, (ox_full, oy_full), keep)
    return result
