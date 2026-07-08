"""Aspect-ratio reframing helpers (pure PIL/numpy).

Given an image and a target ratio, produce the reframed image using a strategy:

* ``cover``  — centre-crop the image to the target ratio (no new pixels).
* ``contain``— place the image on a target-ratio canvas; fill the remainder with a
  blurred, enlarged copy of the image (soft backdrop instead of hard bars).
* ``edge``   — extend the border pixels (reflect/replicate) to fill the remainder.

For ``outpaint`` the geometry is exposed separately: :func:`extend_size` (canvas
that contains the image and hits the target ratio, extending ONE axis) plus
:func:`build_mask` / :func:`feathered_keep_mask` used by the outpaint service.
"""
from __future__ import annotations


def parse_ratio(value: str | None) -> tuple[float, float] | None:
    """Parse ``"16:9"`` → ``(16.0, 9.0)``; ``None``/``"original"``/invalid → ``None``."""
    if not value or value.strip().lower() == "original":
        return None
    parts = value.replace("x", ":").split(":")
    if len(parts) != 2:
        return None
    try:
        rw, rh = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    if rw <= 0 or rh <= 0:
        return None
    return rw, rh


def round8(n: int) -> int:
    """Round up to a multiple of 8 (diffusers/VAE requirement), min 8."""
    return max(8, ((int(n) + 7) // 8) * 8)


def extend_size(w: int, h: int, rw: float, rh: float, scale: float = 1.0) -> tuple[int, int]:
    """Smallest canvas of ratio ``rw:rh`` that fully contains ``w×h`` (extends one
    axis; the image is never shrunk). A wider target grows the width, a taller
    target grows the height.

    ``scale`` (0..1, 1 = fills the frame) shrinks the source *relative to the frame*
    by enlarging the canvas by ``1/scale`` (both axes → the ratio is preserved), so
    the source then occupies ``scale`` of the fitting axis with room to be positioned
    on both axes. ``scale`` 1.0 is the original behaviour."""
    target = rw / rh
    current = w / h
    if target > current:
        cw, ch = max(w, round(h * target)), h
    else:
        cw, ch = w, max(h, round(w / target))
    s = min(1.0, max(0.01, scale))
    if s < 1.0:
        cw, ch = round(cw / s), round(ch / s)
    return cw, ch


def cover(img, rw: float, rh: float, pos_x: float = 0.5, pos_y: float = 0.5):
    """Crop ``img`` to the target ratio (drops the overflowing edges). ``pos_x``/
    ``pos_y`` (0..1, 0.5 = centred) pan which part is kept along the cropped axis."""
    w, h = img.size
    target = rw / rh
    if w / h > target:  # too wide → crop width
        nw, nh = round(h * target), h
    else:  # too tall → crop height
        nw, nh = w, round(w / target)
    left, top = place_offset(w, h, nw, nh, pos_x, pos_y)
    return img.crop((left, top, left + nw, top + nh))


def place_offset(cw: int, ch: int, w: int, h: int, pos_x: float = 0.5, pos_y: float = 0.5) -> tuple[int, int]:
    """Top-left offset for placing a ``w×h`` image in a ``cw×ch`` canvas at the
    normalized position ``pos_x``/``pos_y`` (0..1; 0.5 = centered = the old ``//2``).
    Clamped so the image stays inside the canvas. Along an axis with no spare room
    (``cw == w``) the position has no effect, which is correct for the single-axis
    extend geometry."""
    ox = round(max(0, cw - w) * min(1.0, max(0.0, pos_x)))
    oy = round(max(0, ch - h) * min(1.0, max(0.0, pos_y)))
    return ox, oy


def contain(img, rw: float, rh: float, pos_x: float = 0.5, pos_y: float = 0.5, scale: float = 1.0):
    """Place ``img`` on a target-ratio canvas at ``pos_x``/``pos_y`` (0.5 = centre);
    backdrop = a blurred, cover-scaled copy of the image so there are no hard bars.
    ``scale`` < 1 shrinks the source within a larger canvas (see :func:`extend_size`)."""
    from PIL import ImageFilter

    w, h = img.size
    cw, ch = extend_size(w, h, rw, rh, scale)
    radius = max(8, max(cw, ch) // 24)
    backdrop = img.resize((cw, ch)).filter(ImageFilter.GaussianBlur(radius)).convert("RGB")
    backdrop.paste(img, place_offset(cw, ch, w, h, pos_x, pos_y))
    return backdrop


def edge_extend(img, rw: float, rh: float, pos_x: float = 0.5, pos_y: float = 0.5, scale: float = 1.0):
    """Fill the new area by mirroring/replicating the border pixels, with the source
    placed at ``pos_x``/``pos_y`` (0.5 = centre). ``scale`` < 1 shrinks the source
    within a larger canvas (see :func:`extend_size`)."""
    import numpy as np
    from PIL import Image

    w, h = img.size
    cw, ch = extend_size(w, h, rw, rh, scale)
    left, top = place_offset(cw, ch, w, h, pos_x, pos_y)
    right, bottom = cw - w - left, ch - h - top
    arr = np.asarray(img.convert("RGB"))
    pad = ((top, bottom), (left, right), (0, 0))
    try:
        out = np.pad(arr, pad, mode="reflect")
    except ValueError:  # reflect needs pad < dim; fall back to edge replicate
        out = np.pad(arr, pad, mode="edge")
    return Image.fromarray(out)


def reflect_fill(src, canvas_size: tuple[int, int], offset: tuple[int, int]):
    """Seed a ``canvas_size`` RGB image by reflecting ``src`` outward from
    ``offset`` (x, y) into the new border — a boundary-consistent starting point
    for outpainting (the role Telea inpainting plays in differential-diffusion
    outpainting), so the seam begins from content that matches the edge rather than
    an unrelated blurred copy. Falls back to edge replication when a side is wider
    than the source (reflect requires pad < dimension)."""
    import numpy as np
    from PIL import Image

    cw, ch = canvas_size
    ox, oy = offset
    sw, sh = src.size
    arr = np.asarray(src.convert("RGB"))
    pad = ((oy, ch - sh - oy), (ox, cw - sw - ox), (0, 0))
    try:
        out = np.pad(arr, pad, mode="reflect")
    except ValueError:  # a side exceeds the source dimension → replicate instead
        out = np.pad(arr, pad, mode="edge")
    return Image.fromarray(out)


def apply(img, ratio: tuple[float, float] | None, strategy: str,
          pos_x: float = 0.5, pos_y: float = 0.5, scale: float = 1.0):
    """Reframe ``img`` to ``ratio`` with a non-AI ``strategy`` (cover/contain/edge).
    ``ratio`` None → returns ``img`` unchanged. ``pos_x``/``pos_y`` position the
    source: contain/edge place it in the extended canvas, cover pans the kept crop.
    ``scale`` < 1 shrinks the source within a larger canvas (contain/edge only; cover
    has no surrounding area). Outpaint is handled elsewhere."""
    if ratio is None:
        return img
    rw, rh = ratio
    if strategy == "contain":
        return contain(img, rw, rh, pos_x, pos_y, scale)
    if strategy == "edge":
        return edge_extend(img, rw, rh, pos_x, pos_y, scale)
    return cover(img, rw, rh, pos_x, pos_y)


def to_exact_size(img, width: int | None, height: int | None):
    """Resize ``img`` to exactly ``width``×``height`` (LANCZOS) when BOTH are given
    (a custom target resolution); otherwise return it unchanged. Runs after the
    strategy has produced the correct aspect, so this only sets the exact pixel
    dimensions — and MAY upscale past the source, which is the point of asking for an
    explicit resolution."""
    if not width or not height:
        return img
    from PIL import Image

    if img.size == (width, height):
        return img
    return img.resize((width, height), Image.LANCZOS)


def default_mask_feather(cw: int, ch: int) -> int:
    """Canvas-relative default width of the outpaint mask gradient band."""
    return max(24, min(cw, ch) // 12)


def default_keep_feather(w: int, h: int) -> int:
    """Source-relative default width of the composite-back seam fade."""
    return max(32, min(w, h) // 14)


def default_seed_blur(cw: int, ch: int) -> int:
    """Canvas-relative default blur radius for the reflected border seed."""
    return max(8, max(cw, ch) // 20)


def scale_softness(default: int, softness: float) -> int:
    """Map a normalized ``softness`` in [0, 1] onto ``default``: 0.5 → the default,
    1.0 → 2× (softer/wider), 0.0 → off/hard. Used to make the seam feathers and the
    seed blur user-adjustable while keeping the tuned defaults at the 0.5 midpoint."""
    return max(0, round(default * softness * 2))


def build_mask(canvas_size: tuple[int, int], region: tuple[int, int, int, int], feather: int | None = None):
    """White (=fill) everywhere except ``region`` (=keep), with a wide feathered
    edge so the outpaint blends into the kept content over a broad gradient (the
    standard-inpaint analog of a differential-diffusion change map) instead of a
    hard step. ``region`` is (x0, y0, w, h). ``feather`` defaults to a
    canvas-relative band; the ``//4`` clamp keeps small regions valid. ``feather``
    <= 0 yields a CRISP binary mask (hard edge, no blur) — what FLUX Fill needs,
    since it zeroes the masked init and reads the mask in latent space, so a soft
    edge leaves a grey haze ring; the composite seam does the blend instead."""
    from PIL import Image, ImageDraw, ImageFilter

    cw, ch = canvas_size
    x0, y0, rw, rh = region
    if feather is None:
        feather = default_mask_feather(cw, ch)
    f = max(0, min(feather, rw // 4, rh // 4))
    mask = Image.new("L", (cw, ch), 255)
    ImageDraw.Draw(mask).rectangle([x0 + f, y0 + f, x0 + rw - f, y0 + rh - f], fill=0)
    if f <= 0:
        return mask
    return mask.filter(ImageFilter.GaussianBlur(max(1, f // 2)))


def feathered_keep_mask(size: tuple[int, int], feather: int | None = None):
    """Alpha mask (mode ``L``) the size of the source: 255 (fully keep the source)
    in the interior, fading to 0 over an inset border. Used to composite a pristine
    full-res source back over generated content so only the seam blends and no hard
    edge shows. A wide, canvas-relative fade makes the exact source hand off to the
    AI border gradually. ``size`` is (w, h); the ``//4`` clamp keeps it valid on
    small sources."""
    from PIL import Image, ImageDraw, ImageFilter

    w, h = size
    if feather is None:
        feather = default_keep_feather(w, h)
    f = max(1, min(feather, w // 4, h // 4))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rectangle([f, f, w - f - 1, h - f - 1], fill=255)
    return mask.filter(ImageFilter.GaussianBlur(max(1, f // 2)))
