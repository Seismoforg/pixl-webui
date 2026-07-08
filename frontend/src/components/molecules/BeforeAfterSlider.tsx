"use client";

import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import { useState } from "react";

interface BeforeAfterSliderProps {
  before: string; // data URL / image src shown on the left of the wipe
  after: string; // data URL / image src revealed on the right
  beforeLabel: string;
  afterLabel: string;
}

/**
 * Wipe comparison of two images: a draggable slider clips the "after" image over
 * the "before" so a station's effect is visible. Both images are drawn at the same
 * box size (same photo, aspect preserved), so the clip lines up.
 */
export const BeforeAfterSlider = ({
  before,
  after,
  beforeLabel,
  afterLabel,
}: BeforeAfterSliderProps) => {
  const [pos, setPos] = useState(50);

  const tag = {
    position: "absolute" as const,
    top: 6,
    px: 0.75,
    py: 0.25,
    borderRadius: 0.5,
    fontSize: 11,
    fontWeight: 600,
    color: "common.white",
    bgcolor: "rgba(0,0,0,0.55)",
    pointerEvents: "none" as const,
  };

  return (
    <Box>
      <Box
        sx={{
          position: "relative",
          width: "100%",
          borderRadius: 1,
          overflow: "hidden",
          lineHeight: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <Box
          component="img"
          src={before}
          alt={beforeLabel}
          sx={{ width: "100%", display: "block" }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <Box
          component="img"
          src={after}
          alt={afterLabel}
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            clipPath: `inset(0 ${100 - pos}% 0 0)`,
          }}
        />
        <Box
          sx={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${pos}%`,
            width: "2px",
            bgcolor: "common.white",
            boxShadow: 1,
            pointerEvents: "none",
          }}
        />
        <Box sx={{ ...tag, left: 6 }}>{beforeLabel}</Box>
        <Box sx={{ ...tag, right: 6 }}>{afterLabel}</Box>
      </Box>
      <Slider
        value={pos}
        onChange={(_, v) => setPos(v as number)}
        size="small"
        aria-label={`${beforeLabel} / ${afterLabel}`}
        sx={{ mt: 0.5 }}
      />
    </Box>
  );
};
