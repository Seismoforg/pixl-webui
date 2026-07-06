"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import { useEffect, useRef } from "react";

import { useTranslations } from "@/i18n";
import { coverRect, extendSize, maskFeatherPx, parseRatio, seamFeatherPx } from "@/lib/reframe";
import type { ReframeStrategy } from "@/types";

interface ReframePreviewProps {
  /** Source preview URL (a `data:` upload or a same-origin gallery file URL). */
  preview: string | null;
  /** Full-resolution source size — needed to compute the canvas geometry. */
  dims: { w: number; h: number } | null;
  targetRatio: string;
  strategy: ReframeStrategy;
  /** Outpaint seam-blend softness (0..1); scales the drawn gradient bands. */
  maskSoftness?: number;
  seamSoftness?: number;
  /** Source placement in the extended frame (0..1; 0.5 = centred). */
  posX?: number;
  posY?: number;
  /** Source scale within the frame (0..1; 1 = fills the fitting axis). < 1 enlarges
   * the frame so the source sits smaller inside it (area-adding strategies). */
  scale?: number;
  /** Render only the bare canvas, absolutely filling a positioned parent and
   * semi-transparent — for superimposing the layout over the result image. */
  overlay?: boolean;
}

// Cap the canvas backing store so the draw stays cheap (INP) regardless of the
// source resolution (a one-shot draw per input change); kept high so the scaled
// display stays crisp.
const MAX_DIM = 760;
// Cap the DISPLAYED width so the preview doesn't stretch across the whole column.
const DISPLAY_MAX_W = 520;

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
const drawExtend = (
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
const drawCover = (
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

/**
 * Static canvas preview of the reframe layout: how the target-ratio frame will
 * be composed from the source and which area is new (generated/filled) or cropped.
 * Client-side geometry mirrors the backend, so it needs no generation run. The
 * render is an approximate layout, not the final AI output.
 */
export const ReframePreview = ({
  preview,
  dims,
  targetRatio,
  strategy,
  maskSoftness = 0.5,
  seamSoftness = 0.5,
  posX = 0.5,
  posY = 0.5,
  scale = 1,
  overlay = false,
}: ReframePreviewProps) => {
  const t = useTranslations();
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const ratio = parseRatio(targetRatio);
  // Depend on primitives (not the freshly-allocated `ratio`/`dims` objects) so the
  // canvas only redraws when an input actually changes, not on every parent render.
  const w = dims?.w ?? null;
  const h = dims?.h ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const parsed = parseRatio(targetRatio);
    if (!canvas || !preview || w === null || h === null || !parsed) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const [rw, rh] = parsed;
    const img = new Image();
    img.onload = () => {
      if (strategy === "cover") {
        drawCover(ctx, img, w, h, rw, rh, theme, posX, posY, overlay);
      } else {
        const [cw, ch] = extendSize(w, h, rw, rh, scale);
        drawExtend(ctx, img, cw, ch, w, h, strategy === "outpaint", theme, maskSoftness, seamSoftness, posX, posY, overlay);
      }
    };
    img.src = preview;
    return () => {
      img.onload = null;
    };
  }, [preview, w, h, targetRatio, strategy, theme, maskSoftness, seamSoftness, posX, posY, scale, overlay]);

  // Aspect ratio of the whole frame — reserved up front so the canvas never
  // shifts layout as the image decodes.
  const frameAspect =
    dims && ratio
      ? strategy === "cover"
        ? `${dims.w} / ${dims.h}`
        : extendSize(dims.w, dims.h, ratio[0], ratio[1], scale).join(" / ")
      : undefined;

  const hintKey =
    strategy === "cover"
      ? "reframe.preview.hintCover"
      : strategy === "outpaint"
        ? "reframe.preview.hintOutpaint"
        : "reframe.preview.hintFill";

  // Overlay variant: just the canvas, filling a positioned parent, semi-transparent
  // and non-interactive — superimposed over the result image to recall the layout.
  if (overlay) {
    if (!preview || !dims || !ratio) return null;
    return (
      <Box
        component="canvas"
        ref={canvasRef}
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0.55,
          pointerEvents: "none",
          borderRadius: 1,
        }}
      />
    );
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t("reframe.preview.label")}
      </Typography>
      {preview && dims && ratio ? (
        <>
          <Box
            component="canvas"
            ref={canvasRef}
            role="img"
            aria-label={t("reframe.preview.alt")}
            sx={{
              display: "block",
              width: "100%",
              maxWidth: DISPLAY_MAX_W,
              height: "auto",
              aspectRatio: frameAspect,
              borderRadius: 1,
              border: 1,
              borderColor: "divider",
            }}
          />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            {t(hintKey)} {t("reframe.preview.approx")}
          </Typography>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t("reframe.preview.none")}
        </Typography>
      )}
    </Box>
  );
};
