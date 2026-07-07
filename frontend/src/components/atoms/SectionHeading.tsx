"use client";

import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

type Variant = "h2" | "h3" | "subtitle1" | "subtitle2";

interface SectionHeadingProps {
  children: ReactNode;
  // Semantic heading level (the actual element rendered), keeping a real
  // screen-reader outline: page/section titles are h2, sub-sections are h3.
  level: 2 | 3;
  // Optional visual override; defaults to the matching heading variant.
  variant?: Variant;
  sx?: SxProps<Theme>;
}

/**
 * A heading that pairs a visual style with the correct semantic element, so the
 * document keeps a proper h1 → h2 → h3 hierarchy instead of visual-only titles.
 */
export const SectionHeading = ({ children, level, variant, sx }: SectionHeadingProps) => {
  const resolved: Variant = variant ?? (level === 2 ? "h2" : "h3");
  return (
    <Typography variant={resolved} component={`h${level}`} sx={sx}>
      {children}
    </Typography>
  );
};
