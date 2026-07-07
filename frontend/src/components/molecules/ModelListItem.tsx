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

import { QuantSelect } from "@/components/molecules/QuantSelect";
import { useTranslations } from "@/i18n";
import { fitChipMeta } from "@/lib/fit";
import type { ModelEntry, DownloadProgress } from "@/types";

interface ModelListItemProps {
  model: ModelEntry;
  progress?: DownloadProgress;
  onDownload: (slug: string) => void;
  onDelete: (slug: string) => void;
  onQuantChange?: (slug: string, level: string) => void;
}

/**
 * One catalog model rendered as a compact horizontal row (list layout): identity
 * on the left, metric chips in the middle, the primary action on the right, with
 * the download progress bar spanning the full width below.
 */
export const ModelListItem = ({
  model,
  progress,
  onDownload,
  onDelete,
  onQuantChange,
}: ModelListItemProps) => {
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
  const vramLabel = `${t("models.vram")} ≥ ${model.min_vram_gb} GB`;

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", md: "center" }}
      >
        {/* Identity + origin */}
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75 }}>
            <Typography component="span" variant="subtitle1" fontWeight="medium" sx={{ mr: 0.5 }}>
              {model.name}
            </Typography>
            {model.gated && <Chip label={t("models.gatedHint")} size="small" variant="outlined" />}
            {model.gguf_filename && (
              <Tooltip title={t("models.quantizedHint")}>
                <Chip label={t("models.quantized")} size="small" variant="outlined" />
              </Tooltip>
            )}
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
          <Typography
            variant="body2"
            color="text.secondary"
            title={model.description}
            sx={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {model.description}
          </Typography>
        </Box>

        {/* Metric chips */}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
          <Chip label={model.family} size="small" color="primary" variant="outlined" />
          <Chip label={model.pipeline_tag} size="small" variant="outlined" />
          <Chip
            icon={<StorageIcon />}
            label={`${t("models.size")} ≈ ${model.approx_size_gb} GB`}
            size="small"
            variant="outlined"
          />
          <Chip icon={<MemoryIcon />} label={vramLabel} size="small" variant="outlined" />
          <Tooltip title={fit.tooltip}>
            <Chip label={fit.label} size="small" color={fit.color} variant="outlined" />
          </Tooltip>
        </Box>

        {/* Load-time quantization (non-GGUF only; empty when bnb unavailable) */}
        {onQuantChange && (
          <QuantSelect
            levels={model.quant_levels}
            value={model.load_level}
            suggested={model.suggested_level}
            onChange={(level) => onQuantChange(model.slug, level)}
          />
        )}

        {/* Action */}
        <Box sx={{ flexShrink: 0 }}>
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
              size="small"
              startIcon={<DownloadIcon />}
              onClick={() => onDownload(model.slug)}
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
};
