"use client";

import PhotoSizeSelectLargeIcon from "@mui/icons-material/PhotoSizeSelectLarge";

import { BatchImageResult } from "@/components/organisms/BatchImageResult";
import { useUpscale } from "@/providers/UpscaleProvider";

/** The upscale result column: live stats while running, then the saved image, via
 *  the shared BatchImageResult (single-result case: resultIds is a 0/1-length array). */
export const UpscaleResult = () => {
  const { running, progress, resultId } = useUpscale();
  return (
    <BatchImageResult
      icon={PhotoSizeSelectLargeIcon}
      keyPrefix="upscale.result"
      running={running}
      progress={progress}
      resultIds={resultId ? [resultId] : []}
    />
  );
};
