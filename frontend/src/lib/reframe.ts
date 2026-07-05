// Client-side reframe geometry, mirroring backend app/services/reframe.py so the
// pre-generation preview matches what the server actually produces. Pure math —
// no DOM, no rounding to /8 (that <8px canvas difference is irrelevant to a
// layout preview, which is labelled approximate anyway).

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
 * axis; the image is never shrunk (mirrors `extend_size`). */
export const extendSize = (w: number, h: number, rw: number, rh: number): [number, number] => {
  const target = rw / rh;
  if (target > w / h) return [Math.max(w, Math.round(h * target)), h];
  return [w, Math.max(h, Math.round(w / target))];
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
