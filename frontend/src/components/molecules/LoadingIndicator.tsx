"use client";

import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

interface LoadingIndicatorProps {
  /** Short, already-translated caption of what is loading (optional). */
  label?: string;
  /** Spinner diameter in px. */
  size?: number;
  /** Minimum height of the centering frame, so it reserves space in its parent. */
  minHeight?: number | string;
  sx?: SxProps<Theme>;
}

/**
 * Inline loading indicator: a spinner + optional caption, centered within whatever
 * parent frame is waiting on data. NOT a global overlay — drop it wherever a load
 * is in flight and remove it when the data arrives. Announces itself to screen
 * readers via `role="status"` + `aria-live`.
 */
export const LoadingIndicator = ({
  label,
  size = 32,
  minHeight = 160,
  sx,
}: LoadingIndicatorProps) => (
  <Box
    role="status"
    aria-live="polite"
    sx={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 1.5,
      minHeight,
      width: "100%",
      color: "text.secondary",
      ...sx,
    }}
  >
    <CircularProgress size={size} aria-hidden />
    {label && (
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    )}
  </Box>
);
