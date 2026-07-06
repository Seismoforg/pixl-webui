// Client-side reframe geometry, mirroring backend app/services/reframe.py so the
// pre-generation preview matches what the server actually produces. The geometry
// helpers are pure math — no DOM, no rounding to /8 (that <8px canvas difference
// is irrelevant to a layout preview, which is labelled approximate anyway). This
// module also owns the canvas drawing helpers that visualize that geometry, kept
// alongside it so the two stay in sync.

import { alpha } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";

/** Parse "16:9" → [16, 9]; "original"/invalid/empty → null (mirrors `parse_ratio`). */
export const parseRatio = (value: string | null | undefined): [number, number] | null => {
  if (!value || value.trim().toLowerCase() === "original") return null;
  const parts = value.replace(/x/gi, ":").split(":");
  if (parts.length !== 2) return null;
  const rw = Number(parts[0]);
  const rh = Number(parts[1]);
  if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) return null;
  return [rw, rh];
};

/** Smallest canvas of ratio rw:rh that fully contains w×h — extends exactly one
 * axis; the image is never shrunk (mirrors `extend_size`). `scale` (0..1, 1 = fills
 * the frame) < 1 enlarges the canvas by `1/scale` so the source occupies `scale` of
 * the fitting axis with room to position it on both axes. */
export const extendSize = (
  w: number,
  h: number,
  rw: number,
  rh: number,
  scale = 1,
): [number, number] => {
  const target = rw / rh;
  let [cw, ch] =
    target > w / h ? [Math.max(w, Math.round(h * target)), h] : [w, Math.max(h, Math.round(w / target))];
  const s = Math.min(1, Math.max(0.01, scale));
  if (s < 1) {
    cw = Math.round(cw / s);
    ch = Math.round(ch / s);
  }
  return [cw, ch];
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Crop rectangle of w×h to ratio rw:rh — the region `cover` keeps (mirrors
 * `cover`). `posX`/`posY` (0..1, 0.5 = centred) pan the crop along the cropped
 * axis. Coordinates are in source pixels. */
export const coverRect = (
  w: number,
  h: number,
  rw: number,
  rh: number,
  posX = 0.5,
  posY = 0.5,
): Rect => {
  const target = rw / rh;
  const [nw, nh] = w / h > target ? [Math.round(h * target), h] : [w, Math.round(w / target)];
  return { x: Math.round((w - nw) * posX), y: Math.round((h - nh) * posY), w: nw, h: nh };
};

// Softness → feather-px, mirroring backend reframe.default_*_feather + scale_softness
// (0.5 = tuned default, 1.0 = 2×, 0 = off). Drives the preview's gradient overlay so
// the drawn band width tracks what the server will actually produce.

/** Outpaint mask gradient-band width in canvas pixels for a given softness. */
export const maskFeatherPx = (cw: number, ch: number, softness: number): number =>
  Math.max(0, Math.round(Math.max(24, Math.min(cw, ch) / 12) * softness * 2));

/** Composite-back seam fade width in source pixels for a given softness. */
export const seamFeatherPx = (w: number, h: number, softness: number): number =>
  Math.max(0, Math.round(Math.max(32, Math.min(w, h) / 14) * softness * 2));

// Canvas drawing helpers for ReframePreview — the pure math above decides the
// geometry, these paint it. Kept here so a change to the geometry (e.g. feather
// derivation) is easy to keep in sync with what gets drawn.

// Cap the canvas backing store so the draw stays cheap (INP) regardless of the
// source resolution (a one-shot draw per input change); kept high so the scaled
// display stays crisp.
const MAX_DIM = 760;

/** Paint a soft alpha band hugging a rect's four edges — inward (into the rect,
 * for the mask gradient) or outward (into the surrounding border, for the seam
 * fade) — so the drawn width visualizes the configured feather. Backing-store px. */
const drawFeatherBand = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  band: number,
  base: string,
  peak: number,
  inward: boolean,
) => {
  if (band < 1) return;
  const solid = alpha(base, peak);
  const clear = alpha(base, 0);
  const s = inward ? 1 : -1;
  const edges = [
    { gx0: 0, gy0: y, gx1: 0, gy1: y + s * band, rx: x, ry: inward ? y : y - band, rw: w, rh: band },
    { gx0: 0, gy0: y + h, gx1: 0, gy1: y + h - s * band, rx: x, ry: inward ? y + h - band : y + h, rw: w, rh: band },
    { gx0: x, gy0: 0, gx1: x + s * band, gy1: 0, rx: inward ? x : x - band, ry: y, rw: band, rh: h },
    { gx0: x + w, gy0: 0, gx1: x + w - s * band, gy1: 0, rx: inward ? x + w - band : x + w, ry: y, rw: band, rh: h },
  ];
  for (const e of edges) {
    const g = ctx.createLinearGradient(e.gx0, e.gy0, e.gx1, e.gy1);
    g.addColorStop(0, solid);
    g.addColorStop(1, clear);
    ctx.fillStyle = g;
    ctx.fillRect(e.rx, e.ry, e.rw, e.rh);
  }
};

/** Draw the "new area added" strategies (outpaint / edge / contain): the source
 * sits centred in an extended-ratio frame and the border is the generated/filled
 * region. */
export const drawExtend = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cw: number,
  ch: number,
  w: number,
  h: number,
  outpaint: boolean,
  theme: Theme,
  maskSoftness: number,
  seamSoftness: number,
  posX: number,
  posY: number,
  overlay: boolean,
) => {
  const k = Math.min(1, MAX_DIM / Math.max(cw, ch));
  const bw = Math.round(cw * k);
  const bh = Math.round(ch * k);
  const canvas = ctx.canvas;
  canvas.width = bw;
  canvas.height = bh;

  // Source placement at the chosen position (0.5 = centred, matching the backend).
  const sx = (cw - w) * posX * k;
  const sy = (ch - h) * posY * k;
  const sw = w * k;
  const sh = h * k;

  // Base + tint: the whole frame reads as "new area"; the source leaves the tint
  // showing only in the generated/filled border. In overlay mode (laid over the
  // real result image) we skip the source image and instead punch the source
  // region transparent, so only the frame decorations sit over the result.
  if (overlay) {
    ctx.clearRect(0, 0, bw, bh);
    ctx.fillStyle = alpha(theme.palette.primary.main, 0.22);
    ctx.fillRect(0, 0, bw, bh);
    ctx.clearRect(sx, sy, sw, sh);
  } else {
    ctx.fillStyle = theme.palette.background.default;
    ctx.fillRect(0, 0, bw, bh);
    ctx.fillStyle = alpha(theme.palette.primary.main, 0.22);
    ctx.fillRect(0, 0, bw, bh);
    ctx.drawImage(img, sx, sy, sw, sh);
  }

  // For outpaint, visualize the configured blend widths: the mask gradient band
  // fading inward into the kept source, and the seam fade spreading outward into
  // the generated border. The band widths mirror the backend feather derivation.
  if (outpaint) {
    const primary = theme.palette.primary.main;
    drawFeatherBand(ctx, sx, sy, sw, sh, maskFeatherPx(cw, ch, maskSoftness) * k, primary, 0.4, true);
    drawFeatherBand(ctx, sx, sy, sw, sh, seamFeatherPx(w, h, seamSoftness) * k, primary, 0.28, false);
  }

  // Seam between kept source and generated border.
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = theme.palette.primary.main;
  ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2);
  ctx.setLineDash([]);
};

/** Draw the `cover` strategy: the frame is a centred crop, so show the full
 * source and dim the margins that will be cropped away. */
export const drawCover = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  rw: number,
  rh: number,
  theme: Theme,
  posX: number,
  posY: number,
  overlay: boolean,
) => {
  const k = Math.min(1, MAX_DIM / Math.max(w, h));
  const bw = Math.round(w * k);
  const bh = Math.round(h * k);
  const canvas = ctx.canvas;
  canvas.width = bw;
  canvas.height = bh;

  const keep = coverRect(w, h, rw, rh, posX, posY);
  // Non-overlay: draw the source, dim it, restore the kept region to full
  // brightness. Overlay: skip the image and punch the kept region transparent so
  // only the dimmed cropped-away margins + kept outline sit over the result.
  if (overlay) {
    ctx.clearRect(0, 0, bw, bh);
    ctx.fillStyle = alpha(theme.palette.common.black, 0.55);
    ctx.fillRect(0, 0, bw, bh);
    ctx.clearRect(keep.x * k, keep.y * k, keep.w * k, keep.h * k);
  } else {
    ctx.drawImage(img, 0, 0, bw, bh);
    ctx.fillStyle = alpha(theme.palette.common.black, 0.55);
    ctx.fillRect(0, 0, bw, bh);
    ctx.drawImage(img, keep.x, keep.y, keep.w, keep.h, keep.x * k, keep.y * k, keep.w * k, keep.h * k);
  }

  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = theme.palette.primary.main;
  ctx.strokeRect(keep.x * k + 1, keep.y * k + 1, keep.w * k - 2, keep.h * k - 2);
  ctx.setLineDash([]);
};
