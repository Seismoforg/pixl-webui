"use client";

import Typography from "@mui/material/Typography";
import type { TypographyProps } from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

interface MonoTextProps {
  children: ReactNode;
  variant?: TypographyProps["variant"];
  color?: TypographyProps["color"];
  fontWeight?: TypographyProps["fontWeight"];
  noWrap?: boolean;
  sx?: SxProps<Theme>;
}

/**
 * Numeric readout in the tabular mono family. Use for telemetry, seeds, sizes,
 * dimensions and percentages so numbers align in columns and read as instrument
 * values. Renders an inline <span> so it can sit inside surrounding text.
 */
export const MonoText = ({
  children,
  variant = "inherit",
  color,
  fontWeight,
  noWrap,
  sx,
}: MonoTextProps) => (
  <Typography
    component="span"
    variant={variant}
    color={color}
    fontWeight={fontWeight}
    noWrap={noWrap}
    sx={{
      fontFamily: (theme) => theme.typography.fontFamilyMono,
      fontVariantNumeric: "tabular-nums",
      ...sx,
    }}
  >
    {children}
  </Typography>
);
