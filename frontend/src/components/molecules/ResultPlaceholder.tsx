"use client";

import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

interface ResultPlaceholderProps {
  // Screen-specific glyph (generation/upscale/reframe/…); defaults to a picture.
  icon?: SvgIconComponent;
  children: ReactNode;
}

/**
 * Composed idle/empty state for the result panels: a soft icon above a short hint,
 * centered. Replaces a bare line of muted text floating in an empty box so the
 * result column reads as an intentional "waiting" state rather than a void.
 */
export const ResultPlaceholder = ({
  icon: Icon = ImageOutlinedIcon,
  children,
}: ResultPlaceholderProps) => (
  <Box
    sx={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      gap: 1.5,
      px: 3,
      py: 4,
      m: "auto",
    }}
  >
    <Icon sx={{ fontSize: 44, color: "text.disabled" }} />
    <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
      {children}
    </Typography>
  </Box>
);
