"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlaylistRemoveIcon from "@mui/icons-material/PlaylistRemove";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import { useTranslations } from "@/i18n";
import type { DownloadProgress } from "@/types";

interface CatalogEntryRowProps {
  name: string;
  description: string;
  repoId?: string | null; // HuggingFace repo id → external card link
  badges: ReactNode; // caller-supplied metric chips
  downloaded: boolean;
  progress?: DownloadProgress;
  onDownload: () => void;
  onDeleteDownload: () => void; // remove the weights from disk
  onEdit: () => void; // open the catalog edit dialog
  onRemoveFromCatalog: () => void; // drop the entry from the curated list
  busy?: boolean; // a catalog persist is in flight
}

/**
 * One curated-catalog entry as a rich list row (Settings editors): identity + a
 * badges slot on the left, then the on-disk install action (Download / Downloaded +
 * Delete) and the catalog actions (Edit / Remove-from-catalog) on the right, with a
 * download progress/error bar spanning below. Mirrors ModelListItem's layout but adds
 * the catalog-edit controls; purely presentational (no data fetching).
 */
export const CatalogEntryRow = ({
  name,
  description,
  repoId,
  badges,
  downloaded,
  progress,
  onDownload,
  onDeleteDownload,
  onEdit,
  onRemoveFromCatalog,
  busy,
}: CatalogEntryRowProps) => {
  const t = useTranslations();
  const status = progress?.status ?? (downloaded ? "done" : "idle");
  const isDownloading = status === "downloading";
  const isError = status === "error";

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
              {name}
            </Typography>
            {repoId && (
              <Tooltip title={t("models.hfCard")}>
                <IconButton
                  size="small"
                  component={Link}
                  href={`https://huggingface.co/${repoId}`}
                  target="_blank"
                  rel="noopener"
                  aria-label={t("models.hfCard")}
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
          {description && (
            <Typography
              variant="body2"
              color="text.secondary"
              title={description}
              sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {description}
            </Typography>
          )}
        </Box>

        {/* Metric chips */}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
          {badges}
        </Box>

        {/* Install + catalog actions */}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          {downloaded ? (
            <>
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
                onClick={onDeleteDownload}
              >
                {t("models.delete")}
              </Button>
            </>
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
          <Divider orientation="vertical" flexItem />
          <IconButton
            size="small"
            onClick={onEdit}
            aria-label={t("settings.catalog.edit")}
            disabled={busy}
          >
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={onRemoveFromCatalog}
            aria-label={t("settings.catalog.removeFromCatalog")}
            disabled={busy}
          >
            <PlaylistRemoveIcon fontSize="small" />
          </IconButton>
        </Stack>
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
