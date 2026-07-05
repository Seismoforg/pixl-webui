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
}

/** Upscale-engine dropdown with the selected engine's chips, description and its
 * download button / progress bar. Presentational — state lives in UpscalePanel. */
export const EnginePicker = ({
  engine,
  engines,
  loading = false,
  downloadPercent,
  onSelect,
  onDownload,
}: EnginePickerProps) => {
  const t = useTranslations();
  if (loading && engines.length === 0) {
    return (
      <Box>
        <SectionHeading level={3} sx={{ mb: 1.5 }}>
          {t("upscale.engine.title")}
        </SectionHeading>
        <LoadingIndicator label={t("loading.engines")} minHeight={100} />
      </Box>
    );
  }
  return (
    <Box>
      <SectionHeading level={3} sx={{ mb: 1.5 }}>
        {t("upscale.engine.title")}
      </SectionHeading>
      <TextField
        select
        fullWidth
        label={t("upscale.engine.title")}
        value={engine?.slug ?? ""}
        onChange={(e) => onSelect(e.target.value)}
      >
        {engines.map((e) => (
          <MenuItem key={e.slug} value={e.slug}>
            {e.name}
            {!e.downloaded ? ` — ${t("upscale.outpaint.notInstalled")}` : ""}
          </MenuItem>
        ))}
      </TextField>

      {engine && (
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
          {downloadPercent === null ? (
            <Button variant="contained" startIcon={<DownloadIcon />} onClick={onDownload}>
              {t("upscale.engine.download")}
            </Button>
          ) : (
            <Box>
              <LinearProgress variant="determinate" value={downloadPercent} />
              <Typography variant="caption" color="text.secondary">
                {t("upscale.engine.downloading")} {downloadPercent}%
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
