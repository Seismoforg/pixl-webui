"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import { useMemo } from "react";

import { GenerationForm } from "@/components/organisms/GenerationForm";
import { GenerationResult } from "@/components/organisms/GenerationResult";
import { useTranslations } from "@/i18n";
import type { ModelEntry } from "@/types";

interface GenerationPanelProps {
  models: ModelEntry[];
}

/** Two-column generation view: the sectioned form on the left, the live
 *  preview / result panel on the right. */
export function GenerationPanel({ models }: GenerationPanelProps) {
  const t = useTranslations();
  const downloaded = useMemo(() => models.filter((m) => m.downloaded), [models]);

  if (downloaded.length === 0) {
    return <Alert severity="info">{t("generate.noModelDownloaded")}</Alert>;
  }

  return (
    <Box
      sx={(theme) => ({
        display: "grid",
        gap: 3,
        gridTemplateColumns: { xs: "1fr", md: `${theme.layout.controlColumn}px 1fr` },
        alignItems: "start",
      })}
    >
      <GenerationForm downloaded={downloaded} />
      <GenerationResult />
    </Box>
  );
}
