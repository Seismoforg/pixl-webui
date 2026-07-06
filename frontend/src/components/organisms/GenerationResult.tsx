"use client";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { ResultPlaceholder } from "@/components/molecules/ResultPlaceholder";
import { Thumbnail } from "@/components/molecules/Thumbnail";
import { useGeneration } from "@/providers/GenerationProvider";
import { useTranslations } from "@/i18n";

/** The result column of the generation view: live per-step preview + progress
 *  while running, an error alert, or the finished (batch) images. */
export const GenerationResult = () => {
  const t = useTranslations();
  const gen = useGeneration();
  const { progress, running, images, error } = gen;

  // Which batch image is shown enlarged; clamp when the result set changes.
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    if (selectedIndex >= images.length) setSelectedIndex(0);
  }, [images.length, selectedIndex]);

  const speedLabel = (its: number | null): string | null => {
    if (its === null || its <= 0) return null;
    return its >= 1
      ? t("generate.speedIts", { value: its.toFixed(2) })
      : t("generate.speedSpit", { value: (1 / its).toFixed(2) });
  };

  const percent = progress && progress.total_steps > 0
    ? (progress.current_step / progress.total_steps) * 100
    : 0;
  const selected = Math.min(selectedIndex, Math.max(0, images.length - 1));

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        minHeight: (theme) => theme.layout.resultMinHeight,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        // Sticky result: stays in view while the form scrolls. On mobile it hoists
        // above the form ONLY while there's something to see (running or results);
        // when idle/empty it stays below so the prompt is above the fold.
        position: "sticky",
        top: "calc(var(--app-header-h, 80px) + 8px)",
        alignSelf: "start",
        order: { xs: running || images.length > 0 ? -1 : 0, md: 0 },
        // `order` also flips grid paint order; a z-index keeps the result above
        // the form so its labels don't bleed over the panel (still below AppBar).
        zIndex: 1,
      }}
    >
      {running && progress?.preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <Box
          component="img"
          src={progress.preview}
          alt={t("generate.previewAlt")}
          sx={{
            maxWidth: "100%",
            maxHeight: "60vh",
            borderRadius: 1,
            imageRendering: "pixelated",
          }}
        />
      )}
      {running && progress && (
        <Box sx={{ width: "100%", maxWidth: 480 }}>
          {progress.batch_size > 1 && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {t("generate.imageOfBatch", {
                current: progress.batch_index,
                total: progress.batch_size,
              })}
            </Typography>
          )}
          <Stack
            direction="row"
            justifyContent="space-between"
            sx={{ mb: 0.5 }}
          >
            <Typography variant="body2">
              {progress.phase === "loading"
                ? t("generate.phaseLoading")
                : progress.phase === "finalizing"
                  ? t("generate.phaseFinalizing")
                  : t("generate.step", {
                      current: progress.current_step,
                      total: progress.total_steps,
                    })}
            </Typography>
            {progress.phase === "generating" && speedLabel(progress.its) && (
              <Typography variant="body2" color="text.secondary">
                {speedLabel(progress.its)}
              </Typography>
            )}
          </Stack>
          {progress.phase === "generating" ? (
            <LinearProgress variant="determinate" value={percent} />
          ) : (
            <LinearProgress />
          )}
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
            {t("generate.seedUsed", { seed: progress.seed })}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", whiteSpace: "pre-wrap" }}
          >
            {progress.prompt}
          </Typography>
        </Box>
      )}
      {!running && error && <Alert severity="error">{error}</Alert>}

      {images.length > 0 && (
        <Box sx={{ width: "100%" }}>
          {/* Enlarged selected image (after the run finishes). */}
          {!running && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <Box
                component="img"
                src={images[selected]}
                alt={t("generate.resultAlt")}
                sx={{ display: "block", mx: "auto", maxWidth: "100%", maxHeight: "60vh", borderRadius: 1 }}
              />
              {progress && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 1, display: "block", textAlign: "center" }}
                >
                  {t("generate.seedUsed", { seed: progress.seed + selected })}
                </Typography>
              )}
            </>
          )}

          {/* Thumbnail grid: pick which batch image to view (also fills live). */}
          {(images.length > 1 || running) && (
            <Box
              sx={{
                mt: running ? 0 : 1.5,
                display: "grid",
                gap: 1,
                gridTemplateColumns: (theme) =>
                  `repeat(auto-fill, minmax(${theme.layout.thumbSize}px, 1fr))`,
              }}
            >
              {images.map((src, i) => (
                <Thumbnail
                  key={src}
                  src={src}
                  alt={t("generate.thumbAlt", { index: i + 1 })}
                  sizes="80px"
                  onClick={() => setSelectedIndex(i)}
                  sx={{
                    borderRadius: 1,
                    cursor: "pointer",
                    border: 2,
                    borderColor: !running && i === selected ? "primary.main" : "transparent",
                  }}
                />
              ))}
            </Box>
          )}
        </Box>
      )}

      {!running && !error && images.length === 0 && (
        <ResultPlaceholder icon={AutoAwesomeIcon}>{t("generate.empty")}</ResultPlaceholder>
      )}
    </Paper>
  );
}
