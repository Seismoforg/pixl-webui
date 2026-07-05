"use client";

import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";

interface SkeletonListProps {
  /** Number of placeholder rows to render. */
  count?: number;
  /** Row height (px) — approximate the real list-row height to limit reflow. */
  rowHeight?: number;
  /** Vertical gap between rows on the MUI spacing scale (match the real list). */
  gap?: number;
}

/**
 * Skeleton placeholder for a vertical list of card rows (model / engine lists).
 * Each row is a full-width rounded block sized to the real row height so the
 * skeleton→content swap doesn't shift layout.
 */
export const SkeletonList = ({ count = 4, rowHeight = 96, gap = 1.5 }: SkeletonListProps) => (
  <Stack spacing={gap} aria-hidden>
    {Array.from({ length: count }).map((_, i) => (
      <Skeleton key={i} variant="rounded" height={rowHeight} sx={{ width: "100%" }} />
    ))}
  </Stack>
);
