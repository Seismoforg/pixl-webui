"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import MemoryIcon from "@mui/icons-material/Memory";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import StorageIcon from "@mui/icons-material/Storage";
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

import { useTranslations } from "@/i18n";
import { fitChipMeta } from "@/lib/fit";
import type { ModelEntry, DownloadProgress } from "@/types";

interface ModelCardProps {
  model: ModelEntry;
  progress?: DownloadProgress;
  onDownload: (slug: string) => void;
  onDelete: (slug: string) => void;
}

export function ModelCard({ model, progress, onDownload, onDelete }: ModelCardProps) {
  const t = useTranslations();
  const status = progress?.status ?? model.status;
  const isDownloading = status === "downloading";
  const isDone = model.downloaded || status === "done";
  const isError = status === "error";
  const fitMeta = fitChipMeta(model.fit.verdict);
  const fit = {
    label: t(fitMeta.labelKey),
    color: fitMeta.color,
    tooltip: t(fitMeta.tooltipKey, {
      vram: model.fit.est_vram_gb,
      total: model.fit.gpu_total_gb ?? "?",
    }),
  };
  const vramLabel = model.curated
    ? `${t("models.vram")} ≥ ${model.min_vram_gb} GB`
    : `${t("models.vram")} ≈ ${model.min_vram_gb} GB (${t("models.estimated")})`;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Chip label={model.family} size="small" color="primary" variant="outlined" />
          <Chip label={model.pipeline_tag} size="small" color="secondary" variant="outlined" />
          {model.gated && (
            <Chip label={t("models.gatedHint")} size="small" variant="outlined" />
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Tooltip title={t("models.hfCard")}>
            <IconButton
              size="small"
              component={Link}
              href={`https://huggingface.co/${model.repo_id}`}
              target="_blank"
              rel="noopener"
              aria-label={t("models.hfCard")}
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Box>
          <Typography variant="subtitle1" fontWeight="medium">
            {model.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {model.description}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          <Chip
            icon={<StorageIcon />}
            label={`${t("models.size")} ≈ ${model.approx_size_gb} GB`}
            size="small"
            variant="outlined"
          />
          <Chip
            icon={<MemoryIcon />}
            label={vramLabel}
            size="small"
            variant="outlined"
          />
          <Tooltip title={fit.tooltip}>
            <Chip label={fit.label} size="small" color={fit.color} variant="outlined" />
          </Tooltip>
        </Box>

        {isDownloading && (
          <Box>
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
          <Typography variant="caption" color="error">
            {progress?.error ?? t("models.downloadFailed")}
          </Typography>
        )}

        <Box>
          {isDone ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                icon={<CheckCircleIcon />}
                label={t("models.downloaded")}
                color="success"
                variant="outlined"
                size="small"
              />
              <Button
                size="small"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => onDelete(model.slug)}
              >
                {t("models.delete")}
              </Button>
            </Stack>
          ) : (
            <Button
              variant="contained"
              startIcon={<DownloadIcon />}
              onClick={() => onDownload(model.slug)}
              disabled={isDownloading}
            >
              {isError ? t("models.retry") : t("models.download")}
            </Button>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}
