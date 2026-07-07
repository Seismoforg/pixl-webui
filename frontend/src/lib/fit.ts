// Maps a GPU-fit verdict to its chip color and locale keys, shared by the model
// card and the add-model dialog so both render the badge identically.
import type { FitVerdict } from "@/types";

export type FitChipColor = "success" | "warning" | "error" | "info";

interface FitChipMeta {
  color: FitChipColor;
  labelKey: string;
  tooltipKey: string;
}

const META: Record<FitVerdict, FitChipMeta> = {
  fits_gpu: { color: "success", labelKey: "models.fitFitsGpu", tooltipKey: "models.fitTooltipGpu" },
  fits_offload: {
    color: "warning",
    labelKey: "models.fitOffload",
    tooltipKey: "models.fitTooltipOffload",
  },
  too_large: {
    color: "error",
    labelKey: "models.fitTooLarge",
    tooltipKey: "models.fitTooltipTooLarge",
  },
  cpu_only: { color: "info", labelKey: "models.fitCpu", tooltipKey: "models.fitTooltipCpu" },
};

export const fitChipMeta = (verdict: FitVerdict): FitChipMeta => {
  return META[verdict];
};

// Fit-based grouping for the model/engine lists. Three buckets: entries that run
// fully on the GPU (or CPU-only when there is no GPU), ones that run only via RAM
// offload, and ones that don't fit at all — so oversized entries sink to the end.
export type FitBucket = "available" | "offload" | "tooLarge";

export const fitBucket = (verdict: FitVerdict): FitBucket => {
  if (verdict === "fits_offload") return "offload";
  if (verdict === "too_large") return "tooLarge";
  return "available"; // fits_gpu + cpu_only
};

// Stable in-bucket ordering (best fit first).
export const fitRank: Record<FitVerdict, number> = {
  fits_gpu: 0,
  cpu_only: 1,
  fits_offload: 2,
  too_large: 3,
};
