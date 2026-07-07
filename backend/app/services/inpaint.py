"""User-mask inpainting service — repaint a hand-painted region of an image.

Unlike outpainting (which invents a *border* mask to extend the canvas), the user
supplies the mask by painting on the image. To keep detail on small edits of large
images, generation is decoupled from the source resolution: a padded box around the
painted region is cropped, inpainted at the model's native working resolution, and
composited back over the pristine full-resolution source with a feathered seam — so
untouched pixels stay pixel-exact and only the painted area changes.

Three feather knobs (0..1, 0.5 = tuned default) mirror the reframe/outpaint controls:
``mask_softness`` softens the mask edge fed to the diffuser (Mask gradient),
``seed_softness`` blurs the source pixels under the mask before denoising (Seed blur),
and ``seam_softness`` feathers the composite-back alpha (Composite seam).

Engine load/cache + the inpaint pass live in :mod:`inpaint_engine`, shared with the
outpaint service (only one inpaint pipe is ever loaded).
"""
from __future__ import annotations

from . import inpaint_engine, reframe
from .. import messages, samplers
from .upscalers import UpscalerInfo

# Context padding around the painted region, as a fraction of the region's long
# side (plus a floor), so the model sees enough surrounding image to blend into.
_PAD_FRAC = 0.35
_MIN_PAD = 32


def _round_up(n: float, multiple: int) -> int:
    """Round ``n`` up to the nearest ``multiple`` (min one multiple) — the VAE/latent
    alignment the pipeline requires (/8 for SD·SDXL, /16 for FLUX)."""
    return max(multiple, ((int(round(n)) + multiple - 1) // multiple) * multiple)


def _padded_box(mask, size: tuple[int, int]) -> tuple[int, int, int, int] | None:
    """Bounding box of the painted region, padded for context and clamped to the
    image. ``None`` when the mask is empty (nothing painted)."""
    bbox = mask.getbbox()
    if bbox is None:
        return None
    x0, y0, x1, y1 = bbox
    pad = max(_MIN_PAD, round(max(x1 - x0, y1 - y0) * _PAD_FRAC))
    w, h = size
    return (max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad))


def _feather(mask, cw: int, ch: int, softness: float, default_fn):
    """Gaussian-feather a mask by a softness-scaled, canvas-relative radius; a no-op
    at softness 0."""
    from PIL import ImageFilter

    f = reframe.scale_softness(default_fn(cw, ch), softness)
    if f <= 0:
        return mask
    return mask.filter(ImageFilter.GaussianBlur(max(1, f // 2)))


def _fed_mask(crop_mask, w: int, h: int, is_flux: bool, mask_softness: float):
    """The mask handed to the diffuser at ``w``x``h``. SD/SDXL get a Gaussian-feathered
    edge (Mask gradient). FLUX Fill instead gets a CRISP binary mask: it zeroes the
    masked init and reads the mask in latent space, so a soft edge leaves a darkened
    ghost of the original there (a grey haze ring) — the composite seam softens the
    final paste-back instead. The low threshold keeps the whole painted area filled."""
    from PIL import Image

    resized = crop_mask.resize((w, h), Image.LANCZOS)
    if is_flux:
        return resized.point(lambda p: 255 if p >= 32 else 0)
    return _feather(resized, w, h, mask_softness, reframe.default_mask_feather)


def _expand_mask(mask, px: int):
    """Grow the painted region outward by ~``px`` px (blur + low threshold — O(n)),
    so the edit overshoots the brush stroke and swallows a subject's soft fringe (e.g.
    fur/hair) that would otherwise remain as a halo of the original after compositing.
    A no-op at ``px`` 0."""
    if px <= 0:
        return mask
    from PIL import ImageFilter

    return mask.filter(ImageFilter.GaussianBlur(px)).point(lambda p: 255 if p >= 50 else 0)


def _seed_under_mask(img, mask, cw: int, ch: int, softness: float):
    """Blur the source pixels under ``mask`` so the diffuser isn't anchored to the
    original content there (Seed blur); a no-op at softness 0."""
    from PIL import ImageFilter

    r = reframe.scale_softness(reframe.default_seed_blur(cw, ch), softness)
    if r <= 0:
        return img
    out = img.copy()
    out.paste(img.filter(ImageFilter.GaussianBlur(r)), (0, 0), mask)
    return out


def inpaint_image(
    image, mask, prompt: str, report, engine: UpscalerInfo,
    *, mask_softness: float = 0.5, seam_softness: float = 0.5, seed_softness: float = 0.5,
    mask_expand: float = 0.0,
    negative: str = "", steps: int = inpaint_engine.DEFAULT_STEPS,
    refine_steps: int = inpaint_engine.DEFAULT_REFINE_STEPS,
    guidance: float = inpaint_engine.DEFAULT_GUIDANCE,
    sampler: str | None = None, seed: int | None = None, refine: bool = False,
):
    """Inpaint the painted region of ``image`` (white in ``mask``) with ``engine``.

    ``report`` gets the shared upscale/reframe progress dict. Returns the full-size
    source with only the masked area regenerated. Raises ``ValueError`` when the mask
    is empty. ``refine`` gates a slow full-resolution hires pass when the padded crop
    exceeds the model's working cap (otherwise the native-res result is used)."""
    from PIL import Image

    report({"phase": "loading"})
    img = image.convert("RGB")
    mask = mask.convert("L")
    if mask.size != img.size:
        mask = mask.resize(img.size, Image.NEAREST)

    raw = mask.getbbox()
    if raw is None:
        raise ValueError(messages.INPAINT_MASK_EMPTY)
    # Grow the painted region (relative to its size) so the edit overshoots the brush
    # stroke and swallows a subject's soft fringe (fur/hair) that would otherwise
    # remain as a halo of the original after compositing. Done before the crop box so
    # its padding contains the grown region.
    expand_px = round(mask_expand * 0.1 * max(raw[2] - raw[0], raw[3] - raw[1]))
    mask = _expand_mask(mask, expand_px)

    box = _padded_box(mask, img.size)
    if box is None:
        raise ValueError(messages.INPAINT_MASK_EMPTY)
    x0, y0, x1, y1 = box
    crop_img = img.crop(box)
    crop_mask = mask.crop(box)
    cw, ch = crop_img.size

    pipe = inpaint_engine.load(engine)
    # Z-Image is flow-matching like FLUX → same crisp-mask / native-scheduler / no-
    # negative / 1024-native / align-16 path; treat both under `is_flux`.
    is_flux = inpaint_engine.is_flux(pipe) or inpaint_engine.is_zimage(pipe)
    if sampler and not is_flux:
        samplers.apply_sampler(pipe, sampler)
    cap = inpaint_engine.working_cap(engine, is_flux)
    native = inpaint_engine.working_native(engine, is_flux)
    negative = inpaint_engine.effective_negative(negative)
    generator = inpaint_engine.make_generator(seed)

    # Scale the crop into the model's working range before generating: diffusion
    # models produce incoherent noise below their native resolution, so small crops
    # are scaled UP to `native` (and huge ones DOWN to `cap`); mid-size crops stay 1:1.
    # The crop is fed at a /8 size; the masked region is generated at a sane res, then
    # downscaled back and composited.
    long = max(cw, ch)
    if long < native:
        scale = native / long
    elif long > cap:
        scale = cap / long
    else:
        scale = 1.0
    two_pass = scale < 1.0  # only a downscale needs the hires refine pass
    # FLUX packs latents 2×, so it needs dims divisible by 16 (else it silently
    # resizes + warns, nudging the mask); SD/SDXL only need /8.
    align = 16 if is_flux else 8
    ww, wh = _round_up(cw * scale, align), _round_up(ch * scale, align)
    fed_img = crop_img.resize((ww, wh), Image.LANCZOS)
    fed_mask = _fed_mask(crop_mask, ww, wh, is_flux, mask_softness)
    # Seed blur has no effect on FLUX (it zeroes the masked init), so only SD/SDXL.
    fed_seed = fed_img if is_flux else _seed_under_mask(fed_img, fed_mask, ww, wh, seed_softness)

    pass_total = 2 if (two_pass and refine) else 1
    gen = inpaint_engine.run_inpaint(
        pipe, fed_seed, fed_mask, prompt, negative, report, 1, pass_total,
        steps=steps, guidance=guidance, generator=generator, is_flux_pipe=is_flux,
        phase="inpainting",
    )

    if two_pass and refine:
        # Upscale to full crop resolution and re-add detail with a short low-strength
        # inpaint over the same region (slow, full-res pass).
        fw, fh = _round_up(cw, align), _round_up(ch, align)
        up = gen.resize((fw, fh), Image.LANCZOS)
        full_mask = _fed_mask(crop_mask, fw, fh, is_flux, mask_softness)
        gen = inpaint_engine.run_inpaint(
            pipe, up, full_mask, prompt, negative, report, 2, 2,
            steps=refine_steps, strength=inpaint_engine.REFINE_STRENGTH,
            guidance=guidance, generator=generator, is_flux_pipe=is_flux,
            phase="inpainting",
        )

    # Composite the regenerated crop back over the pristine full-res source, blending
    # only along a feathered seam so untouched pixels stay exact.
    result_crop = gen.resize((cw, ch), Image.LANCZOS)
    seam = _feather(crop_mask, cw, ch, seam_softness, reframe.default_keep_feather)
    out = img.copy()
    out.paste(result_crop, (x0, y0), seam)
    return out
