// Client-side inpaint feather math + mask-overlay compositing, mirroring the
// backend inpaint service so the canvas preview tracks what the server produces.
// Pure canvas/DOM helpers — no React.

import { maskFeatherPx, seamFeatherPx } from "@/lib/reframe";

export { maskFeatherPx, seamFeatherPx };

/** Seed-blur radius in source pixels for a softness (mirrors backend
 * `default_seed_blur` × `scale_softness`): blurs the source under the mask. */
export const seedBlurPx = (w: number, h: number, softness: number): number =>
  Math.max(0, Math.round(Math.max(8, Math.max(w, h) / 20) * softness * 2));

export interface OverlayOptions {
  /** Display→source scale (source px per display px), to convert feather widths. */
  sourceW: number;
  sourceH: number;
  maskSoftness: number; // 0..1 → mask-gradient feather (what gets regenerated)
  seamSoftness: number; // 0..1 → composite-seam band (how far the blend reaches)
  seedSoftness: number; // 0..1 → seed blur of the source under the mask
  tint: string; // rgb() for the regenerate-region fill
}

// Distinct colours for the two edge-feather bands so they're easy to tell apart on
// top of the region fill.
const MASK_BAND = "rgb(34, 211, 238)"; // cyan — mask gradient (AI regenerate reach)
const SEAM_BAND = "rgb(251, 146, 60)"; // amber — composite seam (blend-back reach)

/**
 * Repaint ``overlay`` (display-sized) to visualize the effective inpaint of ``mask``
 * (source-resolution white-on-transparent) over ``sourceImg``. Bottom-up: a blurred
 * seed-source hint clipped to the mask (seed blur), a translucent region fill (where
 * the mask is), then the two edge feathers as distinct-coloured bands ON TOP — amber
 * for the composite seam, cyan for the mask gradient — so each control is legible and
 * tracks its slider live. ``sourceImg`` may be null (no seed hint).
 */
export const renderOverlay = (
  overlay: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  sourceImg: HTMLImageElement | null,
  opts: OverlayOptions,
): void => {
  const ctx = overlay.getContext("2d");
  if (!ctx) return;
  const dw = overlay.width;
  const dh = overlay.height;
  ctx.clearRect(0, 0, dw, dh);
  if (mask.width === 0 || mask.height === 0) return;

  const toDisplay = dw / opts.sourceW; // source px → display px
  const maskF = maskFeatherPx(opts.sourceW, opts.sourceH, opts.maskSoftness) * toDisplay;
  const seamF = seamFeatherPx(opts.sourceW, opts.sourceH, opts.seamSoftness) * toDisplay;
  const seedF = seedBlurPx(opts.sourceW, opts.sourceH, opts.seedSoftness) * toDisplay;

  // Seed-blur hint (bottom): a blurred copy of the source clipped to the mask, so the
  // seed softening is visible; the region fill sits over it translucently.
  if (sourceImg) {
    drawLayer(
      ctx,
      tintedLayer(dw, dh, (c) => {
        c.filter = seedF > 0 ? `blur(${seedF}px)` : "none";
        c.drawImage(sourceImg, 0, 0, dw, dh);
        c.filter = "none";
        c.globalCompositeOperation = "destination-in";
        c.drawImage(mask, 0, 0, dw, dh);
      }),
      0.4,
    );
  }

  // Region fill — where the mask is; translucent so the seed hint + bands read on top.
  drawLayer(ctx, tintMask(mask, dw, dh, 0, opts.tint), 0.28);

  // Edge feather bands ON TOP, each a distinct colour: the composite-seam reach
  // (amber, wider) then the mask-gradient reach (cyan, hugging the edge).
  drawLayer(ctx, bandLayer(mask, dw, dh, seamF, SEAM_BAND), 0.6);
  drawLayer(ctx, bandLayer(mask, dw, dh, maskF, MASK_BAND), 0.7);
};

/** A ring layer: the mask blurred by ``blurPx`` and tinted, with the crisp (unblurred)
 * mask punched out — i.e. only the feather band OUTSIDE the hard edge. Null at
 * ``blurPx`` 0 (no feather → no band). */
const bandLayer = (
  mask: HTMLCanvasElement,
  w: number,
  h: number,
  blurPx: number,
  tint: string,
): HTMLCanvasElement | null => {
  if (blurPx <= 0) return null;
  return tintedLayer(w, h, (c) => {
    c.filter = `blur(${blurPx}px)`;
    c.drawImage(mask, 0, 0, w, h);
    c.filter = "none";
    c.globalCompositeOperation = "source-in";
    c.fillStyle = tint;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = "destination-out";
    c.drawImage(mask, 0, 0, w, h);
  });
};

/** A display-sized layer of the mask blurred by ``blurPx`` and filled with ``tint``
 * where painted (source-in keys on the mask's alpha). */
const tintMask = (
  mask: HTMLCanvasElement,
  w: number,
  h: number,
  blurPx: number,
  tint: string,
): HTMLCanvasElement | null =>
  tintedLayer(w, h, (c) => {
    c.filter = blurPx > 0 ? `blur(${blurPx}px)` : "none";
    c.drawImage(mask, 0, 0, w, h);
    c.filter = "none";
    c.globalCompositeOperation = "source-in";
    c.fillStyle = tint;
    c.fillRect(0, 0, w, h);
  });

/** Composite ``layer`` (if any) onto ``ctx`` at ``alpha``. */
const drawLayer = (
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement | null,
  alpha: number,
): void => {
  if (!layer) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
};

/** Build an offscreen display-sized layer via ``draw`` and return it (or null). */
const tintedLayer = (
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement | null => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  draw(ctx);
  return canvas;
};

/** True when the mask (transparent bg, white strokes) has any painted pixel. */
export const maskHasContent = (mask: HTMLCanvasElement): boolean => {
  const ctx = mask.getContext("2d");
  if (!ctx || mask.width === 0) return false;
  // Sample a downscaled copy to keep this cheap on large masks.
  const s = 64;
  const small = document.createElement("canvas");
  small.width = s;
  small.height = s;
  const sctx = small.getContext("2d");
  if (!sctx) return false;
  sctx.drawImage(mask, 0, 0, s, s);
  const { data } = sctx.getImageData(0, 0, s, s);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 12) return true; // any non-transparent (painted) pixel
  }
  return false;
};

/** Flatten an alpha-keyed white-on-transparent mask onto black and return it as a
 * PNG data URL (white = repaint), preserving the soft edges as grayscale. */
export const maskToDataUrl = (mask: HTMLCanvasElement): string => {
  const out = document.createElement("canvas");
  out.width = mask.width;
  out.height = mask.height;
  const ctx = out.getContext("2d");
  if (!ctx) return mask.toDataURL("image/png");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(mask, 0, 0);
  return out.toDataURL("image/png");
};
