"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import { useEffect, useRef } from "react";

import { useTranslations } from "@/i18n";
import { coverRect, extendSize, parseRatio } from "@/lib/reframe";
import type { ReframeStrategy } from "@/types";

interface ReframePreviewProps {
  /** Source preview URL (a `data:` upload or a same-origin gallery file URL). */
  preview: string | null;
  /** Full-resolution source size — needed to compute the canvas geometry. */
  dims: { w: number; h: number } | null;
  targetRatio: string;
  strategy: ReframeStrategy;
}

// Cap the canvas backing store so the draw stays cheap (INP) regardless of the
// source resolution; CSS scales it down responsively.
const MAX_DIM = 400;

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
) => {
  const k = Math.min(1, MAX_DIM / Math.max(cw, ch));
  const bw = Math.round(cw * k);
  const bh = Math.round(ch * k);
  const canvas = ctx.canvas;
  canvas.width = bw;
  canvas.height = bh;

  const sx = ((cw - w) / 2) * k;
  const sy = ((ch - h) / 2) * k;
  const sw = w * k;
  const sh = h * k;

  // Base + tint: the whole frame reads as "new area"; the source drawn on top
  // leaves the tint showing only in the border that will be generated/filled.
  ctx.fillStyle = theme.palette.background.default;
  ctx.fillRect(0, 0, bw, bh);
  ctx.fillStyle = alpha(theme.palette.primary.main, 0.22);
  ctx.fillRect(0, 0, bw, bh);
  ctx.drawImage(img, sx, sy, sw, sh);

  // Seam between kept source and generated border.
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = theme.palette.primary.main;
  ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2);

  // For outpaint, hint the feathered blend band just inside the seam.
  if (outpaint) {
    const inset = Math.max(4, Math.min(sw, sh) * 0.06);
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = alpha(theme.palette.primary.main, 0.5);
    ctx.strokeRect(sx + inset, sy + inset, sw - inset * 2, sh - inset * 2);
  }
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
) => {
  const k = Math.min(1, MAX_DIM / Math.max(w, h));
  const bw = Math.round(w * k);
  const bh = Math.round(h * k);
  const canvas = ctx.canvas;
  canvas.width = bw;
  canvas.height = bh;

  const keep = coverRect(w, h, rw, rh);
  ctx.drawImage(img, 0, 0, bw, bh);
  // Dim everything, then restore the kept region to full brightness.
  ctx.fillStyle = alpha(theme.palette.common.black, 0.55);
  ctx.fillRect(0, 0, bw, bh);
  ctx.drawImage(img, keep.x, keep.y, keep.w, keep.h, keep.x * k, keep.y * k, keep.w * k, keep.h * k);

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
export const ReframePreview = ({ preview, dims, targetRatio, strategy }: ReframePreviewProps) => {
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
        drawCover(ctx, img, w, h, rw, rh, theme);
      } else {
        const [cw, ch] = extendSize(w, h, rw, rh);
        drawExtend(ctx, img, cw, ch, w, h, strategy === "outpaint", theme);
      }
    };
    img.src = preview;
    return () => {
      img.onload = null;
    };
  }, [preview, w, h, targetRatio, strategy, theme]);

  // Aspect ratio of the whole frame — reserved up front so the canvas never
  // shifts layout as the image decodes.
  const frameAspect =
    dims && ratio
      ? strategy === "cover"
        ? `${dims.w} / ${dims.h}`
        : extendSize(dims.w, dims.h, ratio[0], ratio[1]).join(" / ")
      : undefined;

  const hintKey =
    strategy === "cover"
      ? "reframe.preview.hintCover"
      : strategy === "outpaint"
        ? "reframe.preview.hintOutpaint"
        : "reframe.preview.hintFill";

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
              maxWidth: MAX_DIM,
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
