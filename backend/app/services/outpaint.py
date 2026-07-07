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

Engine load/cache and the single inpaint pass live in :mod:`inpaint_engine`, shared
with the user-mask inpaint service; this module keeps only the reframe geometry.
"""
from __future__ import annotations

from . import inpaint_engine, reframe
from .. import config, samplers
from .inpaint_engine import unload  # re-exported: callers free the shared inpaint pipe
from .upscalers import UpscalerInfo

__all__ = ["reframe_image", "unload"]


def reframe_image(
    image, ratio: tuple[float, float], prompt: str, report, engine: UpscalerInfo,
    *, mask_softness: float = 0.5, seam_softness: float = 0.5, seed_softness: float = 0.5,
    pos_x: float = 0.5, pos_y: float = 0.5, scale: float = 1.0, negative: str = "",
    steps: int = inpaint_engine.DEFAULT_STEPS,
    refine_steps: int = inpaint_engine.DEFAULT_REFINE_STEPS,
    guidance: float = inpaint_engine.DEFAULT_GUIDANCE,
    sampler: str | None = None, seed: int | None = None, refine: bool = False,
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
    supported), and ``seed`` an optional generator seed for a reproducible border.
    ``refine`` gates the (slow, full-resolution) hires refinement pass on large
    canvases; when false the upscaled composition is used directly."""
    report({"phase": "loading"})
    pipe = inpaint_engine.load(engine)
    # Z-Image is flow-matching like FLUX → same crisp-mask / native-scheduler / no-
    # negative / 1024-native path; treat both under `is_flux`.
    is_flux = inpaint_engine.is_flux(pipe) or inpaint_engine.is_zimage(pipe)
    if sampler and not is_flux:
        samplers.apply_sampler(pipe, sampler)
    cap = inpaint_engine.working_cap(engine, is_flux)
    return _reframe_single(
        pipe, image.convert("RGB"), ratio, prompt,
        inpaint_engine.effective_negative(negative), report, cap,
        mask_softness, seam_softness, seed_softness, pos_x, pos_y, scale,
        steps, refine_steps, guidance, inpaint_engine.make_generator(seed), is_flux, refine,
    )


def _reframe_single(pipe, img, ratio, prompt, negative, report, cap,
                    mask_softness=0.5, seam_softness=0.5, seed_softness=0.5,
                    pos_x=0.5, pos_y=0.5, scale=1.0,
                    steps=inpaint_engine.DEFAULT_STEPS,
                    refine_steps=inpaint_engine.DEFAULT_REFINE_STEPS,
                    guidance=inpaint_engine.DEFAULT_GUIDANCE,
                    generator=None, is_flux=False, refine=False):
    from PIL import Image, ImageFilter

    rw, rh = ratio
    sw, sh = img.size

    # Full-resolution target canvas: extend ONE axis so the source is contained at
    # its native size and never shrunk (its pixels stay exact after composite-back).
    # ``scale`` < 1 shrinks the source within a larger canvas so it can be positioned
    # with room around it (more area to outpaint).
    cw_full, ch_full = reframe.extend_size(sw, sh, rw, rh, scale)
    cw_full, ch_full = reframe.round8(cw_full), reframe.round8(ch_full)
    ox_full, oy_full = reframe.place_offset(cw_full, ch_full, sw, sh, pos_x, pos_y)

    # Composition pass at the family cap: the full canvas directly when it already
    # fits (cap_scale == 1 → no upscale, so the border stays sharp), else scaled down
    # to the cap so the model still sees the whole frame in its native range (avoids a
    # duplicate subject). Whatever is lost to that downscale is restored by the
    # hires refinement pass below.
    cap_scale = min(1.0, cap / max(cw_full, ch_full))
    two_pass = cap_scale < 1.0
    cw, ch = reframe.round8(round(cw_full * cap_scale)), reframe.round8(round(ch_full * cap_scale))
    nw, nh = max(8, round(sw * cap_scale)), max(8, round(sh * cap_scale))
    ox, oy = reframe.place_offset(cw, ch, nw, nh, pos_x, pos_y)
    src = img.resize((nw, nh), Image.LANCZOS)

    # Seed the border by reflecting the source outward (a boundary-consistent start
    # that matches the edge, unlike a blurred whole-image copy); then paste the
    # (scaled) source. SD/SDXL soften the reflected seed with a blur so the inpaint
    # sees a gradient rather than a hard mirror line, and get a wide-feathered mask.
    # FLUX Fill instead gets an UNBLURRED init + a CRISP binary mask: it zeroes the
    # masked init and reads the mask in latent space, so a soft edge/blur leaves a
    # grey haze ring — the composite seam (feathered_keep_mask, below) does the blend
    # instead. The mask/seed widths stay user-scalable for SD/SDXL (0.5 = default).
    canvas = reframe.reflect_fill(src, (cw, ch), (ox, oy))
    if not is_flux:
        seed_blur = reframe.scale_softness(reframe.default_seed_blur(cw, ch), seed_softness)
        if seed_blur > 0:
            canvas = canvas.filter(ImageFilter.GaussianBlur(seed_blur))
    canvas.paste(src, (ox, oy))
    mask_feather = 0 if is_flux else reframe.scale_softness(
        reframe.default_mask_feather(cw, ch), mask_softness
    )
    mask = reframe.build_mask((cw, ch), (ox, oy, nw, nh), feather=mask_feather)
    # Report two passes only when a refinement pass will actually follow.
    pass_total = 2 if (two_pass and refine) else 1
    gen = inpaint_engine.run_inpaint(
        pipe, canvas, mask, prompt, negative, report, 1, pass_total,
        steps=steps, guidance=guidance, generator=generator, is_flux_pipe=is_flux,
        phase="outpainting",
    )

    keep = reframe.feathered_keep_mask(
        (sw, sh),
        feather=reframe.scale_softness(reframe.default_keep_feather(sw, sh), seam_softness),
    )
    if not two_pass:
        # Generated at full resolution already — just composite the pristine source
        # back with a feathered seam so only the border is AI content.
        gen.paste(img, (ox_full, oy_full), keep)
        return gen

    # Upscale the low-res composition to the full canvas (soft). When refinement is
    # enabled, a low-strength inpaint over the same border re-adds full-resolution
    # detail (slow, full-res pass); otherwise the upscaled border is used directly.
    # Either way the pristine full-res source is composited back pixel-exact.
    result = gen.resize((cw_full, ch_full), Image.LANCZOS)
    if refine:
        # Crisp mask for FLUX (see the composition pass above); feathered for SD/SDXL.
        full_feather = 0 if is_flux else reframe.scale_softness(
            reframe.default_mask_feather(cw_full, ch_full), mask_softness
        )
        full_mask = reframe.build_mask(
            (cw_full, ch_full), (ox_full, oy_full, sw, sh), feather=full_feather,
        )
        result = inpaint_engine.run_inpaint(
            pipe, result, full_mask, prompt, negative, report, 2, 2,
            steps=refine_steps, strength=inpaint_engine.REFINE_STRENGTH,
            guidance=guidance, generator=generator, is_flux_pipe=is_flux,
            phase="outpainting",
        )
    result.paste(img, (ox_full, oy_full), keep)
    return result
