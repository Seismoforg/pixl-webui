"use client";

import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import Image from "next/image";
import type { KeyboardEventHandler } from "react";

interface ThumbnailProps {
  src: string;
  alt: string;
  /** Layout hint for the optimizer's srcset (~the rendered cell width). */
  sizes?: string;
  onClick?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  role?: string;
  tabIndex?: number;
  ariaLabel?: string;
  /** Styling for the square container (border, radius, cursor, focus/hover). */
  sx?: SxProps<Theme>;
}

/** Square thumbnail that loads a downscaled variant via `next/image` (the Next
 *  optimizer re-encodes to the requested size), so grids don't fetch full-res
 *  originals. `data:` sources (uploads/live previews) can't be optimized and fall
 *  back to a plain <img>. */
export const Thumbnail = ({
  src,
  alt,
  sizes = "200px",
  onClick,
  onKeyDown,
  role,
  tabIndex,
  ariaLabel,
  sx,
}: ThumbnailProps) => (
  <Box
    onClick={onClick}
    onKeyDown={onKeyDown}
    role={role}
    tabIndex={tabIndex}
    aria-label={ariaLabel}
    sx={{ position: "relative", width: "100%", aspectRatio: "1 / 1", overflow: "hidden", ...sx }}
  >
    {src.startsWith("data:") ? (
      // eslint-disable-next-line @next/next/no-img-element
      <Box
        component="img"
        src={src}
        alt={alt}
        sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
    ) : (
      <Image src={src} alt={alt} fill sizes={sizes} style={{ objectFit: "cover" }} />
    )}
  </Box>
);
