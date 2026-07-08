"use client";

import HealingIcon from "@mui/icons-material/Healing";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { InfoTip } from "@/components/molecules/InfoTip";
import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { GalleryPicker } from "@/components/organisms/GalleryPicker";
import { JobPanelShell } from "@/components/organisms/JobPanelShell";
import { RestoreResult } from "@/components/organisms/RestoreResult";
import { SourcePicker } from "@/components/organisms/SourcePicker";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { toImageRequest, useSourcePanel } from "@/lib/useImageSource";
import { useRestore } from "@/providers/RestoreProvider";
import type {
  RestoreEngineOption,
  RestoreEngines,
  RestorePresets,
  RestorePresetStation,
  RestoreStation,
  StationOverride,
} from "@/types";

// Conveyor order + which stations expose a strength slider (upscale is auto-factor).
const STATIONS: { name: RestoreStation; strength: boolean }[] = [
  { name: "preprocess", strength: true },
  { name: "scratch", strength: true },
  { name: "denoise", strength: true },
  { name: "face", strength: true },
  { name: "prior_fusion", strength: true },
  { name: "colorize", strength: true },
  { name: "tone", strength: true },
  { name: "upscale", strength: false },
];

interface RestorePanelProps {
  reloadToken: number;
  initialImageId?: string | null;
}

export const RestorePanel = ({ reloadToken, initialImageId }: RestorePanelProps) => {
  const t = useTranslations();
  const restore = useRestore();
  const {
    running,
    resultId,
    error: jobError,
    source,
    preset,
    stations,
    beautifyPrompt,
    faceEngine,
    upscaleEngine,
    editEngine,
    colorizeEngine,
    setSource,
    setPreset,
    setStationOverride,
    resetStationOverrides,
    setBeautifyPrompt,
    setFaceEngine,
    setUpscaleEngine,
    setEditEngine,
    setColorizeEngine,
  } = restore;

  const src = useSourcePanel(source, setSource, initialImageId);

  const [presets, setPresets] = useState<RestorePresets | null>(null);
  const [engines, setEngines] = useState<RestoreEngines | null>(null);
  useEffect(() => {
    api
      .getRestorePresets()
      .then(setPresets)
      .catch(() => setPresets(null));
    api
      .getRestoreEngines()
      .then(setEngines)
      .catch(() => setEngines(null));
  }, []);

  // Effective station config = per-station user override over the active preset's default.
  const effective = (name: RestoreStation) => {
    const p: Partial<RestorePresetStation> = presets?.[preset]?.stations?.[name] ?? {};
    const o: StationOverride = stations[name] ?? {};
    return {
      enabled: o.enabled ?? p.enabled ?? false,
      strength: o.strength ?? p.strength ?? 0.5,
    };
  };

  const priorFusionOn = effective("prior_fusion").enabled;
  const faceOn = effective("face").enabled;
  const upscaleOn = effective("upscale").enabled;
  const colorizeOn = effective("colorize").enabled;
  // Models section is only relevant when at least one model-backed station runs.
  const showModels = faceOn || upscaleOn || priorFusionOn || colorizeOn;

  const handleRun = () => {
    if (!source) return;
    restore.start({
      ...toImageRequest(source),
      preset,
      stations,
      beautify_prompt: beautifyPrompt,
      face_engine: faceEngine || null,
      upscale_engine: upscaleEngine || null,
      edit_engine: editEngine || null,
      colorize_engine: colorizeEngine || null,
    });
  };

  const handleClear = () => {
    setSource(null);
    setFaceEngine("");
    setUpscaleEngine("");
    setEditEngine("");
    setColorizeEngine("");
    resetStationOverrides();
    setBeautifyPrompt("");
    restore.reset();
  };

  const modelSelect = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: RestoreEngineOption[] | undefined,
  ) => (
    <TextField
      select
      size="small"
      fullWidth
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <MenuItem value="">{t("restore.models.auto")}</MenuItem>
      {(options ?? []).map((o) => (
        <MenuItem key={o.slug} value={o.slug} disabled={!o.downloaded}>
          {o.name}
          {o.downloaded ? "" : ` — ${t("restore.models.notInstalled")}`}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <JobPanelShell
      title={t("restore.title")}
      error={jobError}
      running={running}
      runIcon={<HealingIcon />}
      runLabel={t("restore.run")}
      runningLabel={t("restore.running")}
      onRun={handleRun}
      runDisabled={!source || running}
      onClear={handleClear}
      clearLabel={t("restore.clear")}
      clearDisabled={running || (!source && !resultId)}
      result={<RestoreResult />}
      after={
        <GalleryPicker
          open={src.pickerOpen}
          reloadToken={reloadToken}
          onClose={src.closePicker}
          onPick={src.onPick}
        />
      }
    >
      <SourcePicker {...src.sourcePickerProps} />

      {/* Preset — the analysis-driven starting point; switching resets manual overrides. */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
          <SectionHeading level={3} variant="subtitle2">
            {t("restore.preset.label")}
          </SectionHeading>
          <InfoTip text={t("restore.preset.help")} />
        </Box>
        <TextField
          select
          size="small"
          fullWidth
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value);
            resetStationOverrides();
          }}
        >
          {Object.entries(presets ?? {}).map(([key, info]) => (
            <MenuItem key={key} value={key}>
              {info.label}
            </MenuItem>
          ))}
          {!presets && <MenuItem value={preset}>{preset}</MenuItem>}
        </TextField>
        {presets?.[preset] && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
            {presets[preset].description}
          </Typography>
        )}
      </Box>

      {/* Conveyor: each station = on/off + one strength slider. Analysis + preset pick
          the defaults; toggling here overrides them. */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
          <SectionHeading level={3} variant="subtitle2">
            {t("restore.stations.title")}
          </SectionHeading>
          <InfoTip text={t("restore.stations.help")} />
        </Box>
        <Stack spacing={1.5}>
          {STATIONS.map(({ name, strength }) => {
            const eff = effective(name);
            return (
              <Box key={name}>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={eff.enabled}
                      onChange={(e) => setStationOverride(name, { enabled: e.target.checked })}
                    />
                  }
                  label={t(`restore.station.${name}`)}
                />
                {strength && eff.enabled && (
                  <LabeledSlider
                    label={t("restore.strength")}
                    info={t(`restore.stationHelp.${name}`)}
                    value={eff.strength}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => setStationOverride(name, { strength: v })}
                  />
                )}
              </Box>
            );
          })}
        </Stack>
      </Box>

      {/* Models — pick which model each model-backed station uses (Auto = the first
          downloaded of that role). Only shown for the stations currently enabled. */}
      {showModels && (
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
            <SectionHeading level={3} variant="subtitle2">
              {t("restore.models.title")}
            </SectionHeading>
            <InfoTip text={t("restore.models.help")} />
          </Box>
          <Stack spacing={1.5}>
            {faceOn &&
              modelSelect(t("restore.models.face"), faceEngine, setFaceEngine, engines?.face)}
            {upscaleOn &&
              modelSelect(
                t("restore.models.upscale"),
                upscaleEngine,
                setUpscaleEngine,
                engines?.upscale,
              )}
            {priorFusionOn &&
              modelSelect(t("restore.models.edit"), editEngine, setEditEngine, engines?.edit)}
            {colorizeOn &&
              modelSelect(
                t("restore.models.colorize"),
                colorizeEngine,
                setColorizeEngine,
                engines?.colorize,
              )}
          </Stack>
        </Box>
      )}

      {/* Beautify instruction for the prior-fusion station (structure-preserving edit). */}
      {priorFusionOn && (
        <TextField
          label={t("restore.beautify.label")}
          helperText={t("restore.beautify.help")}
          value={beautifyPrompt}
          onChange={(e) => setBeautifyPrompt(e.target.value)}
          size="small"
          fullWidth
          multiline
          minRows={2}
        />
      )}
    </JobPanelShell>
  );
};
