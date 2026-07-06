"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import MemoryIcon from "@mui/icons-material/Memory";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import StorageIcon from "@mui/icons-material/Storage";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";

import { trackUpscalerDownload, useDownloads } from "@/providers/DownloadProvider";
import { SectionHeading } from "@/components/atoms/SectionHeading";
import { ConfirmDialog } from "@/components/molecules/ConfirmDialog";
import { SkeletonList } from "@/components/molecules/SkeletonList";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { fitBucket, fitChipMeta, fitRank } from "@/lib/fit";
import { useAsyncData } from "@/lib/useAsyncData";
import type { DownloadProgress, UpscalerEngine } from "@/types";

/**
 * Models-page section for upscale/outpaint engines — the counterpart to
 * ModelManager for the engine registry. Lists engines grouped by install state
 * with install/progress/delete (via the app-level DownloadProvider). The curated
 * engine list is edited in Settings (CuratedEnginesEditor), not here.
 */
export const EngineManager = () => {
  const t = useTranslations();
  const downloads = useDownloads();
  const { data, loading, reload } = useAsyncData(() => api.getUpscalers(), []);
  const engines = useMemo<UpscalerEngine[]>(() => data ?? [], [data]);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refresh when a tracked engine download finishes (so `downloaded` flips).
  useEffect(() => {
    if (engines.some((e) => !e.downloaded && downloads.progress[e.slug]?.status === "done")) {
      reload();
    }
  }, [downloads.progress, engines, reload]);

  const installed = useMemo(() => engines.filter((e) => e.downloaded), [engines]);
  // Not-yet-downloaded engines, split into fit buckets (best fit first) like the
  // model list.
  const byBucket = useMemo(() => {
    const rest = engines
      .filter((e) => !e.downloaded)
      .sort((a, b) => fitRank[a.fit.verdict] - fitRank[b.fit.verdict]);
    return {
      available: rest.filter((e) => fitBucket(e.fit.verdict) === "available"),
      offload: rest.filter((e) => fitBucket(e.fit.verdict) === "offload"),
      tooLarge: rest.filter((e) => fitBucket(e.fit.verdict) === "tooLarge"),
    };
  }, [engines]);

  const handleDownload = async (engine: UpscalerEngine) => {
    setError(null);
    try {
      await trackUpscalerDownload(downloads.track, engine, "/models");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (slug: string) => {
    setPendingSlug(null);
    try {
      await api.deleteUpscaler(slug);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const section = (titleKey: string, entries: UpscalerEngine[]) => {
    if (entries.length === 0) return null;
    return (
      <Box>
        <SectionHeading level={3} variant="subtitle2" sx={{ mb: 1.5, color: "text.secondary" }}>
          {t(titleKey)} ({entries.length})
        </SectionHeading>
        <Stack spacing={1.5}>
          {entries.map((engine) => (
            <EngineRow
              key={engine.slug}
              engine={engine}
              progress={downloads.progress[engine.slug]}
              onDownload={() => handleDownload(engine)}
              onDelete={() => setPendingSlug(engine.slug)}
            />
          ))}
        </Stack>
      </Box>
    );
  };

  return (
    <Box sx={{ mt: 5 }}>
      <SectionHeading level={2} sx={{ mb: 1 }}>
        {t("engines.title")}
      </SectionHeading>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t("engines.subtitle")}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && engines.length === 0 ? (
        <SkeletonList count={3} />
      ) : (
        <Stack spacing={3}>
          {section("models.installed", installed)}
          {section("models.available", byBucket.available)}
          {section("models.availableOffload", byBucket.offload)}
          {section("models.availableTooLarge", byBucket.tooLarge)}
        </Stack>
      )}

      <ConfirmDialog
        open={pendingSlug !== null}
        title={t("common.confirmDeleteTitle")}
        message={t("engines.confirmDelete")}
        confirmLabel={t("models.delete")}
        onConfirm={() => pendingSlug && handleDelete(pendingSlug)}
        onClose={() => setPendingSlug(null)}
      />
    </Box>
  );
}

interface EngineRowProps {
  engine: UpscalerEngine;
  progress?: DownloadProgress;
  onDownload: () => void;
  onDelete: () => void;
}

const EngineRow = ({ engine, progress, onDownload, onDelete }: EngineRowProps) => {
  const t = useTranslations();
  const status = progress?.status ?? engine.status;
  const isDownloading = status === "downloading";
  const isError = status === "error";
  const fitMeta = fitChipMeta(engine.fit.verdict);
  const fitTooltip = t(fitMeta.tooltipKey, {
    vram: engine.fit.est_vram_gb,
    total: engine.fit.gpu_total_gb ?? "?",
  });

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", md: "center" }}
      >
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
            <Typography component="span" variant="subtitle1" fontWeight="medium" sx={{ mr: 0.5 }}>
              {engine.name}
            </Typography>
            <Tooltip title={t("models.hfCard")}>
              <IconButton
                size="small"
                component={Link}
                href={`https://huggingface.co/${engine.repo_id}`}
                target="_blank"
                rel="noopener"
                aria-label={t("models.hfCard")}
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {engine.description}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
          <Chip label={t(`engines.kind.${engine.kind}`)} size="small" color="primary" variant="outlined" />
          <Chip label={`${engine.scale}×`} size="small" variant="outlined" />
          {engine.approx_size_gb > 0 && (
            <Chip
              icon={<StorageIcon />}
              label={`${t("models.size")} ≈ ${engine.approx_size_gb} GB`}
              size="small"
              variant="outlined"
            />
          )}
          <Chip
            icon={<MemoryIcon />}
            label={`${t("models.vram")} ≥ ${engine.min_vram_gb} GB`}
            size="small"
            variant="outlined"
          />
          <Tooltip title={fitTooltip}>
            <Chip label={t(fitMeta.labelKey)} size="small" color={fitMeta.color} variant="outlined" />
          </Tooltip>
        </Box>

        <Box sx={{ flexShrink: 0 }}>
          {engine.downloaded ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                icon={<CheckCircleIcon />}
                label={t("models.downloaded")}
                color="success"
                variant="outlined"
                size="small"
              />
              <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={onDelete}>
                {t("models.delete")}
              </Button>
            </Stack>
          ) : (
            <Button
              variant="contained"
              size="small"
              startIcon={<DownloadIcon />}
              onClick={onDownload}
              disabled={isDownloading}
            >
              {isError ? t("models.retry") : t("models.download")}
            </Button>
          )}
        </Box>
      </Stack>

      {isDownloading && (
        <Box sx={{ mt: 1 }}>
          <LinearProgress
            variant={progress?.total_bytes ? "determinate" : "indeterminate"}
            value={progress?.percent ?? 0}
            aria-label={t("models.downloading")}
          />
          <Typography variant="caption" color="text.secondary">
            {t("models.downloading")} {progress ? `${progress.percent}%` : ""}
          </Typography>
        </Box>
      )}

      {isError && (
        <Typography variant="caption" color="error" sx={{ mt: 1, display: "block" }}>
          {progress?.error ?? t("models.downloadFailed")}
        </Typography>
      )}
    </Paper>
  );
}
