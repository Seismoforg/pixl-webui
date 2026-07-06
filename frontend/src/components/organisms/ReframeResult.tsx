"use client";

import LayersIcon from "@mui/icons-material/Layers";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { ReframePreview } from "@/components/molecules/ReframePreview";
import { Thumbnail } from "@/components/molecules/Thumbnail";
import { UpscaleStats } from "@/components/molecules/UpscaleStats";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useReframe } from "@/providers/ReframeProvider";

interface ReframeResultProps {
  /** Source preview URL + full-res size, for the layout preview (from ReframePanel). */
  preview: string | null;
  dims: { w: number; h: number } | null;
}

/** The reframe result column: the layout preview on top, then live stats while
 *  running, then the saved image(s). Outpaint can produce a batch of variants,
 *  shown as a selectable thumbnail grid. Sticky so it stays visible while the
 *  left form scrolls. A toggle superimposes the layout preview over the result. */
export const ReframeResult = ({ preview, dims }: ReframeResultProps) => {
  const t = useTranslations();
  const {
    running,
    progress,
    resultIds,
    targetRatio,
    customWidth,
    customHeight,
    reframe: strategy,
    maskFeather,
    seamFeather,
    posX,
    posY,
    scale,
  } = useReframe();

  // In custom mode the dropdown value is the sentinel "custom"; the preview needs a
  // real aspect, so derive it from the typed W×H.
  const previewRatio = targetRatio === "custom" ? `${customWidth}:${customHeight}` : targetRatio;

  // Which batch variant is shown enlarged; clamp when the result set changes.
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Whether the layout preview is superimposed over the result image.
  const [showOverlay, setShowOverlay] = useState(false);
  useEffect(() => {
    if (selectedIndex >= resultIds.length) setSelectedIndex(0);
  }, [resultIds.length, selectedIndex]);

  const selected = Math.min(selectedIndex, Math.max(0, resultIds.length - 1));
  const selectedId = resultIds[selected];

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        minHeight: (theme) => theme.layout.resultMinHeight,
        position: "sticky",
        top: "calc(var(--app-header-h, 80px) + 8px)",
        alignSelf: "start",
        // On mobile (single column) show the preview+result on top and keep it
        // sticky; desktop keeps the form-left / result-right columns.
        order: { xs: -1, md: 0 },
        // `order` also flips paint order in a grid, so the result would paint
        // behind the form and its labels would bleed over it — lift it with a
        // z-index (still below the AppBar) so it always covers the form.
        zIndex: 1,
      }}
    >
      <SectionHeading level={3} sx={{ mb: 1.5 }}>
        {t("reframe.result.title")}
      </SectionHeading>

      {/* Pre-generation layout preview: the target frame + the new/cropped area. */}
      <Box sx={{ mb: 2 }}>
        <ReframePreview
          preview={preview}
          dims={dims}
          targetRatio={previewRatio}
          strategy={strategy}
          maskSoftness={maskFeather / 100}
          seamSoftness={seamFeather / 100}
          posX={posX / 100}
          posY={posY / 100}
          scale={strategy === "cover" ? 1 : scale / 100}
        />
      </Box>

      {running && (
        <Stack spacing={0.5}>
          {progress && progress.batch_size > 1 && (
            <Typography variant="body2" color="text.secondary">
              {t("reframe.result.imageOfBatch", {
                current: progress.batch_index,
                total: progress.batch_size,
              })}
            </Typography>
          )}
          <UpscaleStats progress={progress} />
        </Stack>
      )}
      {!running && selectedId ? (
        <Stack spacing={1.5}>
          <Box sx={{ position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Box
              component="img"
              src={api.imageFileUrl(selectedId)}
              alt={t("reframe.result.title")}
              sx={{ maxWidth: "100%", borderRadius: 1, display: "block" }}
            />
            {showOverlay && (
              <ReframePreview
                overlay
                preview={preview}
                dims={dims}
                targetRatio={previewRatio}
                strategy={strategy}
                maskSoftness={maskFeather / 100}
                seamSoftness={seamFeather / 100}
                posX={posX / 100}
                posY={posY / 100}
                scale={strategy === "cover" ? 1 : scale / 100}
              />
            )}
            {preview && dims && (
              <Tooltip
                title={t(showOverlay ? "reframe.result.hidePreview" : "reframe.result.showPreview")}
              >
                <IconButton
                  size="small"
                  onClick={() => setShowOverlay((v) => !v)}
                  aria-pressed={showOverlay}
                  aria-label={t(showOverlay ? "reframe.result.hidePreview" : "reframe.result.showPreview")}
                  sx={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    bgcolor: "background.paper",
                    border: 1,
                    borderColor: "divider",
                    color: showOverlay ? "primary.main" : "text.secondary",
                    "&:hover": { bgcolor: "background.paper" },
                  }}
                >
                  <LayersIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>

          {/* Thumbnail grid to pick which batch variant to view. */}
          {resultIds.length > 1 && (
            <Box
              sx={{
                display: "grid",
                gap: 1,
                gridTemplateColumns: (theme) =>
                  `repeat(auto-fill, minmax(${theme.layout.thumbSize}px, 1fr))`,
              }}
            >
              {resultIds.map((id, i) => (
                <Thumbnail
                  key={id}
                  src={api.imageFileUrl(id)}
                  alt={t("reframe.result.thumbAlt", { index: i + 1 })}
                  sizes="80px"
                  onClick={() => setSelectedIndex(i)}
                  sx={{
                    borderRadius: 1,
                    cursor: "pointer",
                    border: 2,
                    borderColor: i === selected ? "primary.main" : "transparent",
                  }}
                />
              ))}
            </Box>
          )}

          <Button
            component={Link}
            href={api.imageFileUrl(selectedId)}
            target="_blank"
            rel="noopener"
            startIcon={<OpenInNewIcon />}
            variant="outlined"
            sx={{ alignSelf: "flex-start" }}
          >
            {t("reframe.result.open")}
          </Button>
        </Stack>
      ) : (
        !running && (
          <Typography variant="body2" color="text.secondary">
            {t("reframe.result.empty")}
          </Typography>
        )
      )}
    </Paper>
  );
};
