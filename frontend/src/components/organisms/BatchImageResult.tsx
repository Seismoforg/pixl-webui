"use client";

import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { SvgIconComponent } from "@mui/icons-material";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState, type ReactNode } from "react";

import { MonoText } from "@/components/atoms/MonoText";
import { SectionHeading } from "@/components/atoms/SectionHeading";
import { ResultPlaceholder } from "@/components/molecules/ResultPlaceholder";
import { Thumbnail } from "@/components/molecules/Thumbnail";
import { UpscaleStats } from "@/components/molecules/UpscaleStats";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { BatchProgress, UpscaleProgress } from "@/types";

// Upscale's progress shape lacks the batch fields (it never batches); accept it
// loosely so the batch line/thumbnail grid below simply never triggers for it.
type MaybeBatchProgress = UpscaleProgress &
  Partial<Pick<BatchProgress, "batch_index" | "batch_size">>;

interface BatchImageResultProps {
  icon: SvgIconComponent;
  /** i18n namespace prefix for title/open/empty/imageOfBatch/thumbAlt, e.g. "inpaint.result". */
  keyPrefix: string;
  running: boolean;
  progress: MaybeBatchProgress | null;
  resultIds: string[];
  /** Extra content rendered above the running/result section (e.g. Reframe's layout preview). */
  beforeContent?: ReactNode;
  /** Extra content overlaid on the result image (absolute-positioned), given the
   *  selected result id (e.g. Reframe's preview-overlay toggle). */
  renderImageOverlay?: (selectedId: string) => ReactNode;
}

/**
 * Shared batch-image result column: sticky panel with live stats while running,
 * then the saved image(s) as a selectable thumbnail grid for a batch of variants.
 * Reused by Upscale (single-result)/Reframe/Inpaint/Edit. Mobile hoist (`order`) is
 * conditional — only lifts above the form once there's something to show, so an
 * empty placeholder doesn't jump to the top.
 */
export const BatchImageResult = ({
  icon: Icon,
  keyPrefix,
  running,
  progress,
  resultIds,
  beforeContent,
  renderImageOverlay,
}: BatchImageResultProps) => {
  const t = useTranslations();

  // Which batch variant is shown enlarged; clamp when the result set changes.
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    if (selectedIndex >= resultIds.length) setSelectedIndex(0);
  }, [resultIds.length, selectedIndex]);

  const selected = Math.min(selectedIndex, Math.max(0, resultIds.length - 1));
  const selectedId = resultIds[selected];

  // Raw (uninterpolated) template so only the numeric substitutions are wrapped in
  // MonoText, keeping the surrounding translated text intact.
  const batchTemplate = t(`${keyPrefix}.imageOfBatch`);
  const batchParts = batchTemplate.split(/(\{current\}|\{total\})/);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        minHeight: (theme) => theme.layout.resultMinHeight,
        // Sticky result: stays in view while the form scrolls; on mobile it moves
        // to the top of the single-column layout only once there's something to show.
        position: "sticky",
        top: "calc(var(--app-header-h, 80px) + 8px)",
        alignSelf: "start",
        order: { xs: running || selectedId ? -1 : 0, md: 0 },
        // `order` also flips grid paint order; a z-index keeps the result above
        // the form so its labels don't bleed over the panel (still below AppBar).
        zIndex: 1,
      }}
    >
      <SectionHeading level={3} sx={{ mb: 1.5 }}>
        {t(`${keyPrefix}.title`)}
      </SectionHeading>

      {beforeContent}

      {running && (
        <Stack spacing={0.5}>
          {progress && progress.batch_size !== undefined && progress.batch_size > 1 && (
            <Typography variant="body2" color="text.secondary">
              {batchParts.map((part, i) =>
                part === "{current}" ? (
                  <MonoText key={i}>{progress.batch_index}</MonoText>
                ) : part === "{total}" ? (
                  <MonoText key={i}>{progress.batch_size}</MonoText>
                ) : (
                  part
                ),
              )}
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
              alt={t(`${keyPrefix}.title`)}
              sx={{ maxWidth: "100%", borderRadius: 1, display: "block" }}
            />
            {renderImageOverlay?.(selectedId)}
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
                  alt={t(`${keyPrefix}.thumbAlt`, { index: i + 1 })}
                  sizes="80px"
                  onClick={() => setSelectedIndex(i)}
                  role="button"
                  tabIndex={0}
                  ariaLabel={t(`${keyPrefix}.thumbAlt`, { index: i + 1 })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedIndex(i);
                    }
                  }}
                  sx={{
                    borderRadius: 1,
                    cursor: "pointer",
                    border: 2,
                    borderColor: i === selected ? "primary.main" : "transparent",
                    "&:focus-visible": {
                      outline: 2,
                      outlineColor: "primary.main",
                      outlineOffset: -2,
                    },
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
            {t(`${keyPrefix}.open`)}
          </Button>
        </Stack>
      ) : (
        !running && <ResultPlaceholder icon={Icon}>{t(`${keyPrefix}.empty`)}</ResultPlaceholder>
      )}
    </Paper>
  );
};
