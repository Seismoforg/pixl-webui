"use client";

import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";

interface LogoProps {
  size?: number;
  sx?: SxProps<Theme>;
}

/**
 * The Pixl app mark (same artwork as app/icon.svg), for use in the UI header.
 * Decorative: hidden from assistive tech since the adjacent app title labels it.
 * Colors are intentionally fixed brand hex values, not theme tokens — the mark
 * should not react to light/dark mode.
 */
export const Logo = ({ size = 32, sx }: LogoProps) => {
  return (
    <Box
      component="svg"
      viewBox="0 0 32 32"
      aria-hidden="true"
      sx={{ width: size, height: size, display: "block", flexShrink: 0, ...sx }}
    >
      <defs>
        <linearGradient id="pixl-logo" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5457e0" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#pixl-logo)" />
      <circle cx="21.5" cy="10.5" r="3" fill="#fff" />
      <path d="M5.5 25.5 L12 16 L16 21 L20 15.5 L26.5 25.5 Z" fill="#fff" />
    </Box>
  );
}
