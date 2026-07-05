"use client";

import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { UpscaleStats } from "@/components/molecules/UpscaleStats";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useUpscale } from "@/providers/UpscaleProvider";

/** The upscale result column: live stats while running, then the saved image. */
export const UpscaleResult = () => {
  const t = useTranslations();
  const { running, progress, resultId } = useUpscale();

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        minHeight: (theme) => theme.layout.resultMinHeight,
        // Sticky result: stays in view while the form scrolls; on mobile it moves
        // to the top of the single-column layout (matches the reframe page).
        position: "sticky",
        top: (theme) => theme.spacing(10),
        alignSelf: "start",
        order: { xs: -1, md: 0 },
        // `order` also flips grid paint order; a z-index keeps the result above
        // the form so its labels don't bleed over the panel (still below AppBar).
        zIndex: 1,
      }}
    >
      <SectionHeading level={3} sx={{ mb: 1.5 }}>
        {t("upscale.result.title")}
      </SectionHeading>
      {running && <UpscaleStats progress={progress} />}
      {resultId ? (
        <Stack spacing={1.5}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <Box
            component="img"
            src={api.imageFileUrl(resultId)}
            alt={t("upscale.result.title")}
            sx={{ maxWidth: "100%", borderRadius: 1, display: "block" }}
          />
          <Button
            component={Link}
            href={api.imageFileUrl(resultId)}
            target="_blank"
            rel="noopener"
            startIcon={<OpenInNewIcon />}
            variant="outlined"
            sx={{ alignSelf: "flex-start" }}
          >
            {t("upscale.result.open")}
          </Button>
        </Stack>
      ) : (
        !running && (
          <Typography variant="body2" color="text.secondary">
            {t("upscale.result.empty")}
          </Typography>
        )
      )}
    </Paper>
  );
};
