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
  fits_offload: { color: "warning", labelKey: "models.fitOffload", tooltipKey: "models.fitTooltipOffload" },
  too_large: { color: "error", labelKey: "models.fitTooLarge", tooltipKey: "models.fitTooltipTooLarge" },
  cpu_only: { color: "info", labelKey: "models.fitCpu", tooltipKey: "models.fitTooltipCpu" },
};

export const fitChipMeta = (verdict: FitVerdict): FitChipMeta => {
  return META[verdict];
}
