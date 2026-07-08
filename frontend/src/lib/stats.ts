import type { UpscaleProgress } from "@/types";

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

interface UpscaleStatsView {
  label: string;
  // Determinate percentage, or null when progress is indeterminate.
  percent: number | null;
  // Formatted speed ("1.2 it/s" / "0.8 s/it"), or null when not measurable.
  speed: string | null;
}

const formatSpeed = (its: number | null, t: TranslateFn): string | null => {
  if (its === null || its <= 0) return null;
  return its >= 1
    ? t("generate.speedIts", { value: its.toFixed(2) })
    : t("generate.speedSpit", { value: (1 / its).toFixed(2) });
};

/**
 * Derives the human-readable status line + progress percentage from an upscale
 * job's stats. Shared by the in-frame stats and the off-route overlay so both
 * read identically. SD x4 reports diffusion steps (per tile); Real-ESRGAN reports
 * only tiles.
 */
export const upscaleStatsView = (
  progress: UpscaleProgress | null,
  t: TranslateFn,
): UpscaleStatsView => {
  const speed = progress ? formatSpeed(progress.its, t) : null;
  if (!progress) return { label: t("upscale.running"), percent: null, speed };
  if (progress.phase === "loading")
    return { label: t("upscale.stats.loading"), percent: null, speed };
  if (progress.phase === "finalizing")
    return { label: t("upscale.stats.finalizing"), percent: null, speed };

  const tiled = progress.total_tiles > 1;
  const stepped = progress.total_steps > 0;

  const parts: string[] = [];
  if (tiled) {
    parts.push(
      t("upscale.stats.tile", { current: progress.current_tile, total: progress.total_tiles }),
    );
  }
  if (stepped) {
    parts.push(
      t("upscale.stats.step", { current: progress.current_step, total: progress.total_steps }),
    );
  }
  // Outpaint/inpaint/edit/compare prefix a task word; upscaling shows just the parts.
  const taskWord: Record<string, string> = {
    outpainting: "upscale.stats.outpainting",
    inpainting: "upscale.stats.inpainting",
    editing: "upscale.stats.editing",
    comparing: "upscale.stats.comparing",
    analyzing: "restore.stats.analyzing",
    restoring: "restore.stats.restoring",
  };
  const filling = progress.phase in taskWord;
  const word = filling ? t(taskWord[progress.phase]) : t("upscale.stats.upscaling");
  const label =
    parts.length > 0 ? (filling ? `${word} · ${parts.join(" · ")}` : parts.join(" · ")) : word;

  const percent = stepped
    ? (progress.current_step / progress.total_steps) * 100
    : tiled
      ? (progress.current_tile / progress.total_tiles) * 100
      : null;

  return { label, percent, speed };
};
