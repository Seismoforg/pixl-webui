"use client";

import BrushIcon from "@mui/icons-material/Brush";

import { BatchImageResult } from "@/components/organisms/BatchImageResult";
import { useInpaint } from "@/providers/InpaintProvider";

/** The inpaint result column: live stats while running, then the saved image(s) —
 *  a selectable thumbnail grid for a batch of variants — via the shared
 *  BatchImageResult. Sticky so it stays visible while the left form/canvas scrolls. */
export const InpaintResult = () => {
  const { running, progress, resultIds } = useInpaint();
  return (
    <BatchImageResult
      icon={BrushIcon}
      keyPrefix="inpaint.result"
      running={running}
      progress={progress}
      resultIds={resultIds}
    />
  );
};
