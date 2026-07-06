"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useEffect, useRef } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { useTranslations } from "@/i18n";
import { drawCover, drawExtend, extendSize, parseRatio } from "@/lib/reframe";
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

// Cap the DISPLAYED width so the preview doesn't stretch across the whole column.
const DISPLAY_MAX_W = 520;

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
      <SectionHeading level={3} variant="subtitle2" sx={{ mb: 1 }}>
        {t("reframe.preview.label")}
      </SectionHeading>
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
