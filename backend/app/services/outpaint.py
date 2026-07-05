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
from .. import config
from ..config import load_settings
from ..device import get_dtype, get_torch_device
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
# Hires refinement pass: a short, low-strength second inpaint at full canvas
# resolution that restores detail the upscaled composition border loses.
_REFINE_STEPS = 24
_REFINE_STRENGTH = 0.35
_DEFAULT_PROMPT = "seamless natural background continuation, high detail"
# Fights the common failure modes: stock watermarks/text and duplicated subjects.
_NEGATIVE = (
    "watermark, text, signature, caption, frame, border, collage, grid, "
    "multiple animals, duplicate, extra subject, blurry, distorted, low quality"
)

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

    from diffusers import AutoPipelineForInpainting

    # Pick the pipeline class from the repo so a custom SDXL inpaint engine loads
    # as SDXL instead of being forced into the SD 1.5 class (which fails). Load the
    # engine's weight variant (curated SD 1.5 inpaint ships only fp16; custom repos
    # carry their own detected variant).
    model_path = config.model_dir(engine.slug)
    kwargs: dict = {"torch_dtype": get_dtype(), "variant": engine.variant}
    # SD 1.x/2.x inpaint pipelines ship a safety checker whose weights we don't
    # fetch, so skip it. SDXL has no safety checker — those kwargs are invalid there.
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


def _inpaint(
    pipe, image, mask, prompt: str, report, tile_index: int, tile_total: int,
    steps: int = _STEPS, strength: float | None = None,
):
    """Run one inpaint pass, reporting step progress under the 'outpainting' phase.
    ``strength`` < 1 turns it into a hires refinement pass; diffusers then runs only
    ``int(steps * strength)`` denoising steps, which the progress total reflects."""
    timer = callbacks.StepTimer()
    total = steps if strength is None else max(1, int(steps * strength))

    def on_step(done: int) -> None:
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
    result = pipe(
        prompt=prompt or _DEFAULT_PROMPT,
        negative_prompt=_NEGATIVE,
        image=image,
        mask_image=mask,
        num_inference_steps=steps,
        guidance_scale=_GUIDANCE,
        **kwargs,
    )
    return result.images[0].resize(image.size)


def reframe_image(image, ratio: tuple[float, float], prompt: str, report, engine: UpscalerInfo):
    """Reframe ``image`` to ``ratio`` by outpainting the new area in a single
    whole-canvas pass with the ``engine`` inpaint model. ``report`` gets the same
    progress dict shape as upscaling."""
    report({"phase": "loading"})
    pipe = _load(engine)
    cap = _SDXL_WORK if _is_sdxl(config.model_dir(engine.slug)) else _SD_WORK
    return _reframe_single(pipe, image.convert("RGB"), ratio, prompt, report, cap)


def _reframe_single(pipe, img, ratio, prompt, report, cap):
    from PIL import Image, ImageFilter

    rw, rh = ratio
    sw, sh = img.size

    # Full-resolution target canvas: extend ONE axis so the source is contained at
    # its native size and never shrunk (its pixels stay exact after composite-back).
    cw_full, ch_full = reframe.extend_size(sw, sh, rw, rh)
    cw_full, ch_full = reframe.round8(cw_full), reframe.round8(ch_full)
    ox_full, oy_full = (cw_full - sw) // 2, (ch_full - sh) // 2

    # Composition pass at the family cap: the full canvas directly when it already
    # fits (scale == 1 → no upscale, so the border stays sharp), else scaled down to
    # the cap so the model still sees the whole frame in its native range (avoids a
    # duplicate subject). Whatever is lost to that downscale is restored by the
    # hires refinement pass below.
    scale = min(1.0, cap / max(cw_full, ch_full))
    two_pass = scale < 1.0
    cw, ch = reframe.round8(round(cw_full * scale)), reframe.round8(round(ch_full * scale))
    nw, nh = max(8, round(sw * scale)), max(8, round(sh * scale))
    ox, oy = (cw - nw) // 2, (ch - nh) // 2
    src = img.resize((nw, nh), Image.LANCZOS)

    # Seed the border with a blurred, cover-scaled copy of the source (a soft
    # starting point), then paste the (scaled) source; mask = the (feathered) border.
    canvas = img.resize((cw, ch)).filter(ImageFilter.GaussianBlur(max(8, max(cw, ch) // 20)))
    canvas = canvas.convert("RGB")
    canvas.paste(src, (ox, oy))
    mask = reframe.build_mask((cw, ch), (ox, oy, nw, nh))
    gen = _inpaint(pipe, canvas, mask, prompt, report, 1, 2 if two_pass else 1)

    keep = reframe.feathered_keep_mask((sw, sh))
    if not two_pass:
        # Generated at full resolution already — just composite the pristine source
        # back with a feathered seam so only the border is AI content.
        gen.paste(img, (ox_full, oy_full), keep)
        return gen

    # Upscale the low-res composition to full canvas (soft), then a low-strength
    # inpaint over the same border re-adds full-resolution detail before the
    # pristine full-res source is composited back pixel-exact.
    result = gen.resize((cw_full, ch_full), Image.LANCZOS)
    full_mask = reframe.build_mask((cw_full, ch_full), (ox_full, oy_full, sw, sh))
    result = _inpaint(
        pipe, result, full_mask, prompt, report, 2, 2,
        steps=_REFINE_STEPS, strength=_REFINE_STRENGTH,
    )
    result.paste(img, (ox_full, oy_full), keep)
    return result
