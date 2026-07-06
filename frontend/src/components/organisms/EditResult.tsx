"use client";

import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";

import { BatchImageResult } from "@/components/organisms/BatchImageResult";
import { useEdit } from "@/providers/EditProvider";

/** The Post-Processing result column: live stats while running, then the saved
 *  image(s) — a selectable thumbnail grid for a batch of variants — via the shared
 *  BatchImageResult. Sticky so it stays visible while the left form scrolls. */
export const EditResult = () => {
  const { running, progress, resultIds } = useEdit();
  return (
    <BatchImageResult
      icon={AutoFixHighIcon}
      keyPrefix="edit.result"
      running={running}
      progress={progress}
      resultIds={resultIds}
    />
  );
};
