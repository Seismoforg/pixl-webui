"use client";

import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { MonoText } from "@/components/atoms/MonoText";
import { useTranslations } from "@/i18n";
import { formatDuration } from "@/lib/duration";
import { upscaleStatsView } from "@/lib/stats";
import type { UpscaleProgress } from "@/types";

/** Live inference stats shown in the result frame while an upscale runs. */
export const UpscaleStats = ({ progress }: { progress: UpscaleProgress | null }) => {
  const t = useTranslations();
  const view = upscaleStatsView(progress, t);
  // Per-phase breakdown of the most recent finished image (load / process / decode /
  // total), like the generation tab. Empty for flows without a breakdown (e.g. compare).
  const timing = progress?.timings.at(-1);

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {view.label}
        </Typography>
        {progress && (
          <MonoText variant="caption" color="text.secondary">
            {view.speed ? `${view.speed} · ` : ""}
            {t("upscale.stats.elapsed", { value: progress.elapsed.toFixed(1) })}
          </MonoText>
        )}
      </Stack>
      {view.percent === null ? (
        <LinearProgress />
      ) : (
        <LinearProgress variant="determinate" value={view.percent} />
      )}
      {progress && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
          {progress.engine_name}
        </Typography>
      )}
      {timing && (
        <MonoText variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
          {[
            t("upscale.stats.timing.load", { value: formatDuration(timing.load) }),
            t("upscale.stats.timing.process", { value: formatDuration(timing.generate) }),
            t("upscale.stats.timing.decode", { value: formatDuration(timing.decode) }),
            t("upscale.stats.timing.total", { value: formatDuration(timing.total) }),
          ].join(" · ")}
        </MonoText>
      )}
    </Box>
  );
};
