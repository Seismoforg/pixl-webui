"""Compose a labelled contact-sheet grid from a set of generated images.

Drives the XYZ-plot compare job: given the images produced by sweeping one or two
parameters, lay them out as a grid (X = columns, Y = rows) with a label gutter
naming each axis value, so the results read as an A1111-style X/Y plot. Pure PIL.
"""
from __future__ import annotations

_PAD = 10  # gap between cells and around the label gutters


def _font():
    """A readable bitmap font, best-effort. Pillow >= 10.1 sizes the built-in font;
    older versions fall back to the fixed-size default."""
    from PIL import ImageFont

    try:
        return ImageFont.load_default(size=18)
    except TypeError:  # Pillow < 10.1 — no size arg
        return ImageFont.load_default()


def _text_size(draw, text: str, font) -> tuple[int, int]:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    return right - left, bottom - top


def compose_grid(
    cells: list[list],
    x_labels: list[str],
    y_labels: list[str],
    title: str = "",
) -> "object":
    """Lay ``cells`` out as a grid and return one PIL image.

    ``cells`` is row-major: ``cells[row][col]`` is the image for Y value ``row`` and
    X value ``col``. ``x_labels`` head the columns, ``y_labels`` the rows. A single
    row/column with an empty label draws no gutter on that axis (1-axis sweeps).
    ``title`` (used for a Z-axis slice) is drawn as a header band above the grid.
    """
    from PIL import Image, ImageDraw

    font = _font()
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    n_rows = len(cells)
    n_cols = len(cells[0]) if n_rows else 0

    # Per-column width / per-row height from the actual images (robust to mixed
    # sizes, though v1 sweeps keep every cell the same size).
    col_w = [
        max(cells[r][c].width for r in range(n_rows)) for c in range(n_cols)
    ]
    row_h = [
        max(cells[r][c].height for c in range(n_cols)) for r in range(n_rows)
    ]

    label_h = _text_size(probe, "Ag", font)[1]
    has_x = any(lbl for lbl in x_labels)
    has_y = any(lbl for lbl in y_labels)

    title_band = label_h + _PAD if title else 0
    top_gutter = title_band + (label_h + _PAD if has_x else 0)
    left_gutter = (
        max((_text_size(probe, lbl, font)[0] for lbl in y_labels), default=0) + _PAD
        if has_y
        else 0
    )

    total_w = left_gutter + sum(col_w) + _PAD * (n_cols + 1)
    total_h = top_gutter + sum(row_h) + _PAD * (n_rows + 1)

    canvas = Image.new("RGB", (total_w, total_h), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)

    # Column x-origins and row y-origins (cell content, past the gutters).
    x_orig = [left_gutter + _PAD]
    for c in range(1, n_cols):
        x_orig.append(x_orig[c - 1] + col_w[c - 1] + _PAD)
    y_orig = [top_gutter + _PAD]
    for r in range(1, n_rows):
        y_orig.append(y_orig[r - 1] + row_h[r - 1] + _PAD)

    ink = (20, 20, 20)
    if title:
        draw.text((_PAD // 2, _PAD // 2), title, fill=ink, font=font)
    if has_x:
        for c in range(n_cols):
            tw, _ = _text_size(draw, x_labels[c], font)
            cx = x_orig[c] + (col_w[c] - tw) // 2
            draw.text((cx, title_band + _PAD // 2), x_labels[c], fill=ink, font=font)
    if has_y:
        for r in range(n_rows):
            _tw, th = _text_size(draw, y_labels[r], font)
            cy = y_orig[r] + (row_h[r] - th) // 2
            draw.text((_PAD // 2, cy), y_labels[r], fill=ink, font=font)

    for r in range(n_rows):
        for c in range(n_cols):
            canvas.paste(cells[r][c].convert("RGB"), (x_orig[c], y_orig[r]))

    return canvas
