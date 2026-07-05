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
import { useReframe } from "@/providers/ReframeProvider";

/** The reframe result column: live stats while running, then the saved image. */
export const ReframeResult = () => {
  const t = useTranslations();
  const { running, progress, resultId } = useReframe();

  return (
    <Paper variant="outlined" sx={{ p: 2, minHeight: (theme) => theme.layout.resultMinHeight }}>
      <SectionHeading level={3} sx={{ mb: 1.5 }}>
        {t("reframe.result.title")}
      </SectionHeading>
      {running && <UpscaleStats progress={progress} />}
      {resultId ? (
        <Stack spacing={1.5}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <Box
            component="img"
            src={api.imageFileUrl(resultId)}
            alt={t("reframe.result.title")}
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
