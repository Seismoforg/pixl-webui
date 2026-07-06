"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DownloadIcon from "@mui/icons-material/Download";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { useTranslations } from "@/i18n";
import type { UpscalerEngine } from "@/types";

interface EnginePickerProps {
  engine: UpscalerEngine | null;
  engines: UpscalerEngine[];
  /** True while the engine list is still loading (shows a spinner, not an empty box). */
  loading?: boolean;
  /** Live download percent for the selected engine, or null when not downloading. */
  downloadPercent: number | null;
  onSelect: (slug: string) => void;
  onDownload: () => void;
  /** Show the section heading above the select (default true). Compact callers
   *  (Reframe/Inpaint/Edit) embed the select inline in their own section and omit it. */
  showHeading?: boolean;
  /** Field/heading label (defaults to the upscaler-engine label). */
  label?: string;
  /** Suffix appended to a not-downloaded engine's dropdown entry. */
  notInstalledLabel?: string;
  /** Helper text shown under the select. */
  helperText?: string;
  /** Show the scale/size/downloaded chip row + description (default true). Compact
   *  callers show `needsModelText` instead. */
  showDetails?: boolean;
  /** Caption shown above the download control when the engine isn't downloaded and
   *  `showDetails` is false (e.g. "Needs the 4.2 GB model"). */
  needsModelText?: string;
  downloadLabel?: string;
  downloadingLabel?: string;
  downloadButtonSize?: "small" | "medium";
  loadingMinHeight?: number;
  fullWidth?: boolean;
  fieldSize?: "small" | "medium";
  fieldSx?: SxProps<Theme>;
}

/** Engine dropdown (upscale/outpaint/inpaint/edit) with an optional chips+description
 * detail block and its download button / progress bar. Presentational — state lives
 * in the panel. Defaults reproduce the original Upscale look; compact callers
 * override label/helperText/showDetails/etc. to match their inline block instead. */
export const EnginePicker = ({
  engine,
  engines,
  loading = false,
  downloadPercent,
  onSelect,
  onDownload,
  showHeading = true,
  label,
  notInstalledLabel,
  helperText,
  showDetails = true,
  needsModelText,
  downloadLabel,
  downloadingLabel,
  downloadButtonSize = "medium",
  loadingMinHeight = 100,
  fullWidth = true,
  fieldSize = "medium",
  fieldSx,
}: EnginePickerProps) => {
  const t = useTranslations();
  const fieldLabel = label ?? t("upscale.engine.title");
  const notInstalled = notInstalledLabel ?? t("upscale.engine.notInstalled");
  const downloadBtnLabel = downloadLabel ?? t("upscale.engine.download");
  const downloadingCaption = downloadingLabel ?? t("upscale.engine.downloading");

  if (loading && engines.length === 0) {
    return (
      <Box>
        {showHeading && (
          <SectionHeading level={3} sx={{ mb: 1.5 }}>
            {fieldLabel}
          </SectionHeading>
        )}
        <LoadingIndicator label={t("loading.engines")} minHeight={loadingMinHeight} />
      </Box>
    );
  }
  return (
    <Box>
      {showHeading && (
        <SectionHeading level={3} sx={{ mb: 1.5 }}>
          {fieldLabel}
        </SectionHeading>
      )}
      <TextField
        select
        fullWidth={fullWidth}
        size={fieldSize}
        label={fieldLabel}
        value={engine?.slug ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        helperText={helperText}
        sx={fieldSx}
      >
        {engines.map((e) => (
          <MenuItem key={e.slug} value={e.slug}>
            {e.name}
            {!e.downloaded ? ` (${notInstalled})` : ""}
          </MenuItem>
        ))}
      </TextField>

      {showDetails && engine && (
        <>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mt: 1.5 }}>
            <Chip label={`${engine.scale}×`} size="small" variant="outlined" />
            <Chip label={`≈ ${engine.approx_size_gb} GB`} size="small" variant="outlined" />
            {engine.downloaded && (
              <Chip
                icon={<CheckCircleIcon />}
                label={t("upscale.engine.downloaded")}
                color="success"
                variant="outlined"
                size="small"
              />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {engine.description}
          </Typography>
        </>
      )}

      {engine && !engine.downloaded && (
        <Box sx={{ mt: 1.5 }}>
          {!showDetails && needsModelText && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              {needsModelText}
            </Typography>
          )}
          {downloadPercent === null ? (
            <Button
              variant="contained"
              size={downloadButtonSize}
              startIcon={<DownloadIcon />}
              onClick={onDownload}
            >
              {downloadBtnLabel}
            </Button>
          ) : (
            <Box>
              <LinearProgress variant="determinate" value={downloadPercent} />
              <Typography variant="caption" color="text.secondary">
                {downloadingCaption} {downloadPercent}%
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
