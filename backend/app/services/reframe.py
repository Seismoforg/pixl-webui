"""Aspect-ratio reframing helpers (pure PIL/numpy).

Given an image and a target ratio, produce the reframed image using a strategy:

* ``cover``  — centre-crop the image to the target ratio (no new pixels).
* ``contain``— place the image on a target-ratio canvas; fill the remainder with a
  blurred, enlarged copy of the image (soft backdrop instead of hard bars).
* ``edge``   — extend the border pixels (reflect/replicate) to fill the remainder.

For ``outpaint`` the geometry is exposed separately: :func:`extend_size` (canvas
that contains the image and hits the target ratio, extending ONE axis) and
:func:`outpaint_regions` / :func:`build_mask` used by the outpaint service.
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


def extend_size(w: int, h: int, rw: float, rh: float) -> tuple[int, int]:
    """Smallest canvas of ratio ``rw:rh`` that fully contains ``w×h`` (extends one
    axis; the image is never shrunk). A wider target grows the width, a taller
    target grows the height."""
    target = rw / rh
    current = w / h
    if target > current:
        return max(w, round(h * target)), h
    return w, max(h, round(w / target))


def cover(img, rw: float, rh: float):
    """Centre-crop ``img`` to the target ratio (drops the overflowing edges)."""
    w, h = img.size
    target = rw / rh
    if w / h > target:  # too wide → crop width
        nw, nh = round(h * target), h
    else:  # too tall → crop height
        nw, nh = w, round(w / target)
    left, top = (w - nw) // 2, (h - nh) // 2
    return img.crop((left, top, left + nw, top + nh))


def contain(img, rw: float, rh: float):
    """Centre ``img`` on a target-ratio canvas; backdrop = a blurred, cover-scaled
    copy of the image so there are no hard bars."""
    from PIL import ImageFilter

    w, h = img.size
    cw, ch = extend_size(w, h, rw, rh)
    radius = max(8, max(cw, ch) // 24)
    backdrop = img.resize((cw, ch)).filter(ImageFilter.GaussianBlur(radius)).convert("RGB")
    backdrop.paste(img, ((cw - w) // 2, (ch - h) // 2))
    return backdrop


def edge_extend(img, rw: float, rh: float):
    """Fill the new area by mirroring/replicating the border pixels."""
    import numpy as np
    from PIL import Image

    w, h = img.size
    cw, ch = extend_size(w, h, rw, rh)
    left, top = (cw - w) // 2, (ch - h) // 2
    right, bottom = cw - w - left, ch - h - top
    arr = np.asarray(img.convert("RGB"))
    pad = ((top, bottom), (left, right), (0, 0))
    try:
        out = np.pad(arr, pad, mode="reflect")
    except ValueError:  # reflect needs pad < dim; fall back to edge replicate
        out = np.pad(arr, pad, mode="edge")
    return Image.fromarray(out)


def apply(img, ratio: tuple[float, float] | None, strategy: str):
    """Reframe ``img`` to ``ratio`` with a non-AI ``strategy`` (cover/contain/edge).
    ``ratio`` None → returns ``img`` unchanged. Outpaint is handled elsewhere."""
    if ratio is None:
        return img
    rw, rh = ratio
    if strategy == "contain":
        return contain(img, rw, rh)
    if strategy == "edge":
        return edge_extend(img, rw, rh)
    return cover(img, rw, rh)


def build_mask(canvas_size: tuple[int, int], region: tuple[int, int, int, int], feather: int = 24):
    """White (=fill) everywhere except ``region`` (=keep), with a feathered edge so
    the outpaint blends into the kept content. ``region`` is (x0, y0, w, h)."""
    from PIL import Image, ImageDraw, ImageFilter

    cw, ch = canvas_size
    x0, y0, rw, rh = region
    f = max(0, min(feather, rw // 4, rh // 4))
    mask = Image.new("L", (cw, ch), 255)
    ImageDraw.Draw(mask).rectangle([x0 + f, y0 + f, x0 + rw - f, y0 + rh - f], fill=0)
    return mask.filter(ImageFilter.GaussianBlur(max(1, f // 2)))


def feathered_keep_mask(size: tuple[int, int], feather: int = 32):
    """Alpha mask (mode ``L``) the size of the source: 255 (fully keep the source)
    in the interior, fading to 0 over a ``feather``-px inset border. Used to
    composite a pristine full-res source back over generated content so only the
    seam blends and no hard edge shows. ``size`` is (w, h)."""
    from PIL import Image, ImageDraw, ImageFilter

    w, h = size
    f = max(1, min(feather, w // 4, h // 4))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rectangle([f, f, w - f - 1, h - f - 1], fill=255)
    return mask.filter(ImageFilter.GaussianBlur(max(1, f // 2)))
