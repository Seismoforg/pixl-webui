"use client";

import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import type { SxProps, Theme } from "@mui/material/styles";

interface InfoTipProps {
  text: string;
  sx?: SxProps<Theme>;
}

/**
 * A small info button that reveals an explanatory tooltip on hover/focus. Uses a
 * real button element so it is keyboard- and screen-reader-accessible; callers
 * can size the icon via `sx.fontSize` (the icon inherits the button's fontSize).
 */
export const InfoTip = ({ text, sx }: InfoTipProps) => {
  return (
    <Tooltip title={text} arrow enterTouchDelay={0}>
      <IconButton
        aria-label={text}
        size="small"
        sx={{
          p: 0.75,
          fontSize: 18,
          color: "text.secondary",
          // Bump the hit area to ~44px on touch (icon stays visually small) so the
          // most-reused interactive atom clears the touch-target size guideline.
          "@media (pointer: coarse)": { padding: "13px" },
          ...sx,
        }}
      >
        <InfoOutlinedIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  );
};
