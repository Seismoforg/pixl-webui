"use client";

import BrushIcon from "@mui/icons-material/Brush";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import InvertColorsIcon from "@mui/icons-material/InvertColors";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslations } from "@/i18n";
import { maskHasContent, maskToDataUrl, renderOverlay } from "@/lib/inpaint";

interface InpaintCanvasProps {
  /** Source image URL (upload data URL or gallery file URL), or null. */
  preview: string | null;
  brushSize: number; // display px diameter
  brushSoftness: number; // 0..100
  maskSoftness: number; // 0..1 — mask-gradient feather
  seamSoftness: number; // 0..1 — composite-seam band
  seedSoftness: number; // 0..1 — seed blur under the mask
  disabled?: boolean;
  /** The painted mask as a white-on-black PNG data URL, or null when empty. When
   *  set to null externally (e.g. "clear all"), the canvas resets. */
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}

/**
 * Paint-a-mask editor: the source image with two overlaid canvases — a mask overlay
 * that tints the painted region (and visualizes the three feather controls live) and
 * a top cursor canvas that shows the brush as size + softness rings (like a paint
 * program) and captures pointer strokes. The mask is stored at source resolution as
 * white-on-transparent (so the tint keys on the painted area only) and exported
 * flattened onto black (white = repaint) on every stroke.
 */
export const InpaintCanvas = ({
  preview,
  brushSize,
  brushSoftness,
  maskSoftness,
  seamSoftness,
  seedSoftness,
  disabled,
  value,
  onChange,
}: InpaintCanvasProps) => {
  const t = useTranslations();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const cursorRef = useRef<HTMLCanvasElement | null>(null);
  // Mask stored at source resolution (transparent bg, white strokes); never in the DOM.
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const painting = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null); // last stroke point (source px)
  const hover = useRef<{ x: number; y: number } | null>(null); // cursor pos (display px)
  const rafRef = useRef<number | null>(null);

  const [mode, setMode] = useState<"paint" | "erase">("paint");
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [displayW, setDisplayW] = useState(0);

  const displayH = dims && displayW ? Math.round((displayW * dims.h) / dims.w) : 0;

  // Repaint the mask overlay from the current mask + feather controls.
  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const mask = maskRef.current;
    if (!overlay || !mask || !dims) return;
    renderOverlay(overlay, mask, imgRef.current, {
      sourceW: dims.w,
      sourceH: dims.h,
      maskSoftness,
      seamSoftness,
      seedSoftness,
      tint: "rgb(99, 102, 241)",
    });
  }, [dims, maskSoftness, seamSoftness, seedSoftness]);

  // Coalesce overlay repaints to one per animation frame — the overlay runs
  // blur-heavy canvas ops, so repainting on every pointermove would jank (INP).
  const refreshOverlay = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      drawOverlay();
    });
  }, [drawOverlay]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // Draw the brush cursor (size ring + soft-core ring) at the hover position.
  const drawCursor = useCallback(() => {
    const cur = cursorRef.current;
    if (!cur) return;
    const ctx = cur.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cur.width, cur.height);
    const pos = hover.current;
    if (!pos || disabled) return;
    const r = Math.max(2, brushSize / 2);
    // Outer ring = full brush extent (dark halo + white line so it reads on any image).
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // Inner dashed ring = the hard core; the gap to the outer ring is the softness.
    const inner = r * (1 - Math.min(0.98, brushSoftness / 100));
    if (inner < r - 1.5) {
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(1, inner), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [brushSize, brushSoftness, disabled]);

  // Load the source image → capture natural size + build the mask canvas.
  useEffect(() => {
    setDims(null);
    imgRef.current = null;
    if (!preview) {
      onChange(null);
      return;
    }
    const img = new Image();
    // No crossOrigin: we never read pixels back from a canvas the source is drawn
    // on (only the source-free mask canvas is sampled/exported), and requesting
    // CORS would make gallery images fail to load when the header is absent.
    img.onload = () => {
      imgRef.current = img;
      const mask = document.createElement("canvas");
      mask.width = img.naturalWidth;
      mask.height = img.naturalHeight;
      // Transparent background — the overlay keys the tint on painted (opaque) pixels.
      maskRef.current = mask;
      onChange(null); // a fresh source starts with an empty mask
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = preview;
    // onChange is stable (provider setter); exclude to avoid reloading on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  // Track the rendered width so the overlay canvases match the displayed image.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setDisplayW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims]);

  // Size both overlay canvases to the display size, then repaint.
  useEffect(() => {
    if (!displayW || !displayH) return;
    for (const ref of [overlayRef, cursorRef]) {
      const c = ref.current;
      if (c) {
        c.width = displayW;
        c.height = displayH;
      }
    }
    refreshOverlay();
    drawCursor();
  }, [displayW, displayH, refreshOverlay, drawCursor]);

  // React to feather-slider changes (overlay) and brush-size/softness changes (cursor).
  useEffect(() => {
    refreshOverlay();
  }, [refreshOverlay]);
  useEffect(() => {
    drawCursor();
  }, [drawCursor]);

  // External clear (value set to null while the mask has content): wipe it.
  useEffect(() => {
    if (value !== null) return;
    const mask = maskRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, mask.width, mask.height);
    refreshOverlay();
  }, [value, refreshOverlay]);

  const exportMask = useCallback(() => {
    const mask = maskRef.current;
    if (!mask) return;
    onChange(maskHasContent(mask) ? maskToDataUrl(mask) : null);
  }, [onChange]);

  // Stamp one soft dab (or an erase dab) into the mask at a source-space point.
  const dab = useCallback(
    (x: number, y: number, r: number) => {
      const mask = maskRef.current;
      const ctx = mask?.getContext("2d");
      if (!ctx) return;
      if (mode === "erase") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      // White with a soft edge (brush softness); over a transparent bg the alpha
      // edge is the feather. source-over builds strokes up cleanly. At softness 0 a
      // radial gradient with equal inner/outer radii is degenerate (paints nothing),
      // so fall back to a solid fill for a hard brush.
      ctx.globalCompositeOperation = "source-over";
      const soft = Math.min(0.98, brushSoftness / 100);
      if (soft <= 0) {
        ctx.fillStyle = "rgba(255,255,255,1)";
      } else {
        const grad = ctx.createRadialGradient(x, y, r * (1 - soft), x, y, r);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    },
    [mode, brushSoftness],
  );

  // Paint from the last point to (clientX, clientY), interpolating so fast drags
  // don't leave gaps. Coordinates map display px → source px.
  const stroke = useCallback(
    (clientX: number, clientY: number) => {
      const cur = cursorRef.current;
      if (!cur || !dims) return;
      const rect = cur.getBoundingClientRect();
      const scale = dims.w / rect.width;
      const x = (clientX - rect.left) * scale;
      const y = (clientY - rect.top) * scale;
      const r = Math.max(1, (brushSize / 2) * scale);
      const from = lastPt.current ?? { x, y };
      const dist = Math.hypot(x - from.x, y - from.y);
      const step = Math.max(1, r / 2);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= n; i++) {
        dab(from.x + ((x - from.x) * i) / n, from.y + ((y - from.y) * i) / n, r);
      }
      lastPt.current = { x, y };
    },
    [dims, brushSize, dab],
  );

  const setHover = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    hover.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || !dims) return;
    painting.current = true;
    lastPt.current = null;
    cursorRef.current?.setPointerCapture(e.pointerId);
    setHover(e);
    stroke(e.clientX, e.clientY);
    refreshOverlay();
    drawCursor();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    setHover(e);
    if (painting.current) {
      stroke(e.clientX, e.clientY);
      refreshOverlay();
    }
    drawCursor();
  };
  const endStroke = () => {
    if (!painting.current) return;
    painting.current = false;
    lastPt.current = null;
    refreshOverlay();
    exportMask();
  };
  const onPointerLeave = () => {
    hover.current = null;
    drawCursor();
    endStroke();
  };

  const clearMask = () => onChange(null);

  // Invert the mask: white everywhere minus the current strokes. Filling white then
  // punching the mask out gives alpha = 1 − maskAlpha (color stays white).
  const invertMask = () => {
    const mask = maskRef.current;
    const ctx = mask?.getContext("2d");
    if (!mask || !ctx) return;
    const inv = document.createElement("canvas");
    inv.width = mask.width;
    inv.height = mask.height;
    const ictx = inv.getContext("2d");
    if (!ictx) return;
    ictx.fillStyle = "#fff";
    ictx.fillRect(0, 0, inv.width, inv.height);
    ictx.globalCompositeOperation = "destination-out";
    ictx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, mask.width, mask.height);
    ctx.drawImage(inv, 0, 0);
    refreshOverlay();
    exportMask();
  };

  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 1, alignItems: "center", flexWrap: "wrap", gap: 1 }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_, v) => v && setMode(v)}
          disabled={disabled || !preview}
        >
          <ToggleButton value="paint">
            <BrushIcon fontSize="small" sx={{ mr: 0.5 }} />
            {t("inpaint.canvas.paint")}
          </ToggleButton>
          <ToggleButton value="erase">{t("inpaint.canvas.erase")}</ToggleButton>
        </ToggleButtonGroup>
        <Button
          size="small"
          startIcon={<InvertColorsIcon />}
          onClick={invertMask}
          disabled={disabled || !preview}
        >
          {t("inpaint.canvas.invert")}
        </Button>
        <Button
          size="small"
          startIcon={<DeleteOutlineIcon />}
          onClick={clearMask}
          disabled={disabled || !preview}
        >
          {t("inpaint.canvas.clear")}
        </Button>
      </Stack>

      <Box
        ref={wrapRef}
        sx={{
          position: "relative",
          width: "100%",
          borderRadius: 1,
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
          bgcolor: "action.hover",
          minHeight: preview ? undefined : 200,
          touchAction: "none",
        }}
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={t("inpaint.canvas.source")}
              style={{ display: "block", width: "100%", height: "auto" }}
            />
            {/* Mask overlay (tint + feather visualization); not interactive. */}
            <canvas
              ref={overlayRef}
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            />
            {/* Cursor canvas on top: brush rings + pointer capture. */}
            <canvas
              ref={cursorRef}
              role="img"
              aria-label={t("inpaint.canvas.ariaLabel")}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerLeave={onPointerLeave}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                cursor: disabled ? "default" : "none",
                touchAction: "none",
              }}
            />
          </>
        ) : (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              {t("inpaint.canvas.empty")}
            </Typography>
          </Box>
        )}
      </Box>
      {preview && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
          {t("inpaint.canvas.hint")}
        </Typography>
      )}
    </Box>
  );
};
