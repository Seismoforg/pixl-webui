"use client";

import DownloadIcon from "@mui/icons-material/Download";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";

import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { MonoText } from "@/components/atoms/MonoText";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { trackLoraDownload, useDownloads } from "@/providers/DownloadProvider";
import { useGeneration } from "@/providers/GenerationProvider";
import type { LoraEntry } from "@/types";

interface LoraPickerProps {
  /** Family of the currently-selected base model; only matching LoRAs are shown. */
  family: string | undefined;
  /** Append trigger words to the prompt (one-tap from a LoRA row). */
  onAppendPrompt: (text: string) => void;
}

/**
 * Lists the LoRAs compatible with the selected model family: enable + blend-weight
 * each, download the ones not on disk, and one-tap their trigger words into the
 * prompt. Selection lives in the generation context (`loras`). Incompatible picks
 * are pruned when the model family changes.
 */
export const LoraPicker = ({ family, onAppendPrompt }: LoraPickerProps) => {
  const t = useTranslations();
  const gen = useGeneration();
  const downloads = useDownloads();

  const { data, loading, error, reload } = useAsyncData(() => api.getLoras(), []);
  const loras = useMemo(() => data ?? [], [data]);
  const compatible = useMemo(() => loras.filter((l) => l.family === family), [loras, family]);

  const [dlError, setDlError] = useState<string | null>(null);

  // Prune selected LoRAs that no longer match the model family (once the list has
  // loaded, so an in-flight fetch doesn't clear a valid selection).
  useEffect(() => {
    if (data === null || family === undefined) return;
    const ok = new Set(compatible.map((l) => l.slug));
    const pruned = gen.loras.filter((l) => ok.has(l.slug));
    if (pruned.length !== gen.loras.length) gen.setLoras(pruned);
  }, [data, family, compatible, gen]);

  // Reload the list once a LoRA download finishes so `downloaded` flips.
  const doneSignal = compatible.map((l) => downloads.progress[l.slug]?.status).join(",");
  useEffect(() => {
    if (compatible.some((l) => downloads.progress[l.slug]?.status === "done")) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneSignal]);

  const weightOf = (slug: string) => gen.loras.find((l) => l.slug === slug)?.weight;
  const isOn = (slug: string) => gen.loras.some((l) => l.slug === slug);

  const toggle = (slug: string) =>
    gen.setLoras(
      isOn(slug) ? gen.loras.filter((l) => l.slug !== slug) : [...gen.loras, { slug, weight: 1.0 }],
    );
  const setWeight = (slug: string, weight: number) =>
    gen.setLoras(gen.loras.map((l) => (l.slug === slug ? { ...l, weight } : l)));

  const startDownload = async (lora: LoraEntry) => {
    setDlError(null);
    try {
      await trackLoraDownload(downloads.track, lora, "/generate");
    } catch (err) {
      setDlError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) return <LoadingIndicator minHeight={80} label={t("lora.loading")} />;
  if (error)
    return (
      <Typography color="error" variant="body2">
        {t("lora.loadError")}
      </Typography>
    );
  if (family === undefined) return null;
  if (compatible.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("lora.emptyForFamily", { family })}
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t("lora.help")}
      </Typography>
      {dlError && (
        <Typography color="error" variant="body2">
          {dlError}
        </Typography>
      )}

      {compatible.map((lora) => {
        const dl = downloads.progress[lora.slug];
        const downloading = dl?.status === "downloading";
        const on = isOn(lora.slug);
        return (
          <Box key={lora.slug} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, flexWrap: "wrap" }}>
              {lora.downloaded ? (
                <FormControlLabel
                  sx={{ mr: "auto" }}
                  control={
                    <Checkbox checked={on} onChange={() => toggle(lora.slug)} size="small" />
                  }
                  label={
                    <Box>
                      <Typography
                        variant="body2"
                        component="span"
                        sx={{ fontWeight: "fontWeightMedium" }}
                      >
                        {lora.name}
                      </Typography>
                      {lora.description && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {lora.description}
                        </Typography>
                      )}
                    </Box>
                  }
                />
              ) : (
                <Box sx={{ mr: "auto" }}>
                  <Typography variant="body2" sx={{ fontWeight: "fontWeightMedium" }}>
                    {lora.name}
                  </Typography>
                  {lora.description && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {lora.description}
                    </Typography>
                  )}
                </Box>
              )}

              {lora.trigger && (
                <Chip
                  label={t("lora.trigger", { trigger: lora.trigger })}
                  size="small"
                  variant="outlined"
                  onClick={() => onAppendPrompt(lora.trigger as string)}
                />
              )}

              {!lora.downloaded && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={() => startDownload(lora)}
                  disabled={downloading}
                >
                  {downloading
                    ? t("lora.downloading", { percent: dl?.percent ?? 0 })
                    : t("lora.download", { size: lora.approx_size_gb })}
                </Button>
              )}
            </Box>

            {downloading && (
              <LinearProgress
                variant={dl?.total_bytes ? "determinate" : "indeterminate"}
                value={dl?.percent ?? 0}
                sx={{ mt: 1, borderRadius: 1 }}
              />
            )}

            {lora.downloaded && on && (
              <Box sx={{ mt: 1.5 }}>
                <LabeledSlider
                  label={t("lora.weight")}
                  value={weightOf(lora.slug) ?? 1.0}
                  min={0}
                  max={1.5}
                  step={0.05}
                  info={t("lora.weightInfo")}
                  onChange={(v) => setWeight(lora.slug, v)}
                />
              </Box>
            )}
          </Box>
        );
      })}

      {gen.loras.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {t("lora.activeCount")
            .split(/(\{count\})/)
            .map((part, i) =>
              part === "{count}" ? <MonoText key={i}>{gen.loras.length}</MonoText> : part,
            )}
        </Typography>
      )}
    </Stack>
  );
};
