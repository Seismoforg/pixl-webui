"use client";

import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { Thumbnail } from "@/components/molecules/Thumbnail";
import { UpscaleStats } from "@/components/molecules/UpscaleStats";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useEdit } from "@/providers/EditProvider";

/** The Post-Processing result column: live stats while running, then the saved
 *  image(s) — a selectable thumbnail grid for a batch of variants. Sticky so it
 *  stays visible while the left form scrolls. Mirrors InpaintResult. */
export const EditResult = () => {
  const t = useTranslations();
  const { running, progress, resultIds } = useEdit();

  const [selectedIndex, setSelectedIndex] = useState(0);
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
        order: { xs: -1, md: 0 },
        zIndex: 1,
      }}
    >
      <SectionHeading level={3} sx={{ mb: 1.5 }}>
        {t("edit.result.title")}
      </SectionHeading>

      {running && (
        <Stack spacing={0.5}>
          {progress && progress.batch_size > 1 && (
            <Typography variant="body2" color="text.secondary">
              {t("edit.result.imageOfBatch", {
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <Box
            component="img"
            src={api.imageFileUrl(selectedId)}
            alt={t("edit.result.title")}
            sx={{ maxWidth: "100%", borderRadius: 1, display: "block" }}
          />

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
                  alt={t("edit.result.thumbAlt", { index: i + 1 })}
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
            {t("edit.result.open")}
          </Button>
        </Stack>
      ) : (
        !running && (
          <Typography variant="body2" color="text.secondary">
            {t("edit.result.empty")}
          </Typography>
        )
      )}
    </Paper>
  );
};
