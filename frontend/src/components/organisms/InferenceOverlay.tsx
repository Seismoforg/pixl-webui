"use client";

import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { useGeneration } from "@/generation/GenerationProvider";
import { useTranslations } from "@/i18n";

interface InferenceOverlayProps {
  onClick: () => void;
}

/**
 * Small floating progress card shown while a generation runs and the user is on
 * another tab. Deliberately a `position: fixed` Paper (not a MUI Modal/Dialog):
 * no backdrop, no focus trap — the rest of the page stays fully interactive.
 */
export function InferenceOverlay({ onClick }: InferenceOverlayProps) {
  const t = useTranslations();
  const { progress } = useGeneration();

  const speed = (its: number | null): string | null => {
    if (its === null || its <= 0) return null;
    return its >= 1
      ? t("generate.speedIts", { value: its.toFixed(1) })
      : t("generate.speedSpit", { value: (1 / its).toFixed(1) });
  };

  const percent = progress && progress.total_steps > 0
    ? (progress.current_step / progress.total_steps) * 100
    : 0;

  const header = !progress
    ? t("generate.running")
    : progress.phase === "loading"
      ? t("generate.phaseLoading")
      : progress.phase === "finalizing"
        ? t("generate.phaseFinalizing")
        : t("generate.step", {
            current: progress.current_step,
            total: progress.total_steps,
          });

  return (
    <Paper
      elevation={6}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={t("overlay.title")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      sx={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: (theme) => theme.zIndex.snackbar,
        width: 300,
        maxWidth: "calc(100vw - 32px)",
        p: 2,
        cursor: "pointer",
        borderRadius: 2,
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline">
          <Typography variant="subtitle2">{t("overlay.title")}</Typography>
          {progress && progress.phase === "generating" && speed(progress.its) && (
            <Typography variant="caption" color="text.secondary">
              {speed(progress.its)}
            </Typography>
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {header}
        </Typography>
        {progress && progress.phase === "generating" ? (
          <LinearProgress variant="determinate" value={percent} />
        ) : (
          <LinearProgress />
        )}
        <Box>
          {progress && (
            <Typography variant="caption" color="text.secondary" display="block">
              {t("generate.seedUsed", { seed: progress.seed })}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {t("overlay.tapToView")}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}
