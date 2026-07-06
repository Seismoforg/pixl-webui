"use client";

import GridViewIcon from "@mui/icons-material/GridView";

import { BatchImageResult } from "@/components/organisms/BatchImageResult";
import { useCompare } from "@/providers/CompareProvider";

/** Sticky result column for the XYZ-plot compare screen: live sweep stats, then the
 *  composed grid sheet(s) as a selectable thumbnail set. Thin wrapper over the
 *  shared BatchImageResult (each Z-slice sheet is one result image). */
export const CompareResult = () => {
  const { running, progress, resultIds } = useCompare();
  return (
    <BatchImageResult
      icon={GridViewIcon}
      keyPrefix="compare.result"
      running={running}
      progress={progress}
      resultIds={resultIds}
    />
  );
};
