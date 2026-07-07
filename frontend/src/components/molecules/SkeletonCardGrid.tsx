"use client";

import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import useMediaQuery from "@mui/material/useMediaQuery";

interface SkeletonCardGridProps {
  /** Number of placeholder tiles to render. */
  count?: number;
  /** Min tile width (px) — mirror the real grid's `minmax` so there's no reflow. */
  minWidth?: number;
  /** Grid gap on the MUI spacing scale (match the real grid). */
  gap?: number;
  /** Caption skeleton lines below each square tile (0 = square only). */
  lines?: number;
}

/**
 * Skeleton placeholder for a responsive square-card grid (gallery / picker /
 * batch thumbnails). Uses the same auto-fill `minmax` template as the real grids
 * so the swap from skeleton to content doesn't shift layout (CLS).
 */
export const SkeletonCardGrid = ({
  count = 8,
  minWidth = 220,
  gap = 2,
  lines = 0,
}: SkeletonCardGridProps) => {
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const animation = prefersReducedMotion ? false : "pulse";
  return (
    <Box
      aria-hidden
      sx={{
        display: "grid",
        gap,
        gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Box key={i}>
          {/* Wrapper owns the square aspect ratio so the tile height is reliable
              regardless of MUI Skeleton's default height handling. */}
          <Box sx={{ aspectRatio: "1 / 1" }}>
            <Skeleton
              variant="rounded"
              animation={animation}
              sx={{ width: "100%", height: "100%" }}
            />
          </Box>
          {lines > 0 && (
            <Box sx={{ pt: 1 }}>
              {Array.from({ length: lines }).map((_, j) => (
                <Skeleton
                  key={j}
                  variant="text"
                  animation={animation}
                  width={j === lines - 1 ? "60%" : "100%"}
                />
              ))}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
};
