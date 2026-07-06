"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { AppSettings, ModelEntry, SystemInfo, UpscalerEngine } from "@/types";

interface SettingsPanelProps {
  system: SystemInfo | null;
}

const PerfSwitch = ({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => {
  return (
    <Box>
      <FormControlLabel
        control={<Switch checked={checked} onChange={(e) => onChange(e.target.checked)} />}
        label={label}
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 6, mt: -0.5 }}>
        {help}
      </Typography>
    </Box>
  );
}

const InfoRow = ({ label, value }: { label: string; value: string }) => {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-all", textAlign: "right" }}>
        {value}
      </Typography>
    </Box>
  );
}

export const SettingsPanel = ({ system }: SettingsPanelProps) => {
  const t = useTranslations();
  const [token, setToken] = useState("");
  const [perf, setPerf] = useState({
    vae_tiling: true,
    vae_slicing: true,
    xformers: true,
    torch_compile: false,
  });
  const [sdX4Steps, setSdX4Steps] = useState(50);
  const [outpaintNegative, setOutpaintNegative] = useState("");
  // Preferred default dropdown selections ("" = Auto / first downloaded).
  const [defModel, setDefModel] = useState("");
  const [defUpscaler, setDefUpscaler] = useState("");
  const [defOutpaint, setDefOutpaint] = useState("");
  // Downloaded entries to populate the default dropdowns.
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [engines, setEngines] = useState<UpscalerEngine[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setToken(s.hf_token ?? "");
        setPerf({
          vae_tiling: s.vae_tiling,
          vae_slicing: s.vae_slicing,
          xformers: s.xformers,
          torch_compile: s.torch_compile,
        });
        setSdX4Steps(s.sd_x4_steps);
        setOutpaintNegative(s.outpaint_negative);
        setDefModel(s.default_model ?? "");
        setDefUpscaler(s.default_upscaler ?? "");
        setDefOutpaint(s.default_outpaint_engine ?? "");
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    // Downloaded models/engines populate the default dropdowns (best-effort).
    api.getModels().then(setModels).catch(() => setModels([]));
    api.getUpscalers().then(setEngines).catch(() => setEngines([]));
  }, []);

  const downloadedModels = models.filter((m) => m.downloaded);
  const downloadedUpscalers = engines.filter((e) => e.downloaded && e.kind !== "inpaint");
  const downloadedOutpaint = engines.filter((e) => e.downloaded && e.kind === "inpaint");

  const handleSave = async () => {
    setSaving(true);
    setError(false);
    try {
      const payload: AppSettings = {
        hf_token: token.trim() === "" ? null : token.trim(),
        ...perf,
        sd_x4_steps: Math.max(1, Math.round(sdX4Steps) || 1),
        outpaint_negative: outpaintNegative,
        default_model: defModel || null,
        default_upscaler: defUpscaler || null,
        default_outpaint_engine: defOutpaint || null,
      };
      await api.saveSettings(payload);
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const setFlag = (key: keyof typeof perf) => (checked: boolean) => {
    setPerf((p) => ({ ...p, [key]: checked }));
    setSaved(false);
  };

  // A default-selection dropdown: an "Auto (first downloaded)" option + the given
  // downloaded entries.
  const defaultSelect = (
    label: string,
    value: string,
    setter: (v: string) => void,
    options: { slug: string; name: string }[],
  ) => (
    <TextField
      select
      label={label}
      value={value}
      onChange={(e) => {
        setter(e.target.value);
        setSaved(false);
      }}
    >
      <MenuItem value="">{t("settings.defaults.auto")}</MenuItem>
      {options.map((o) => (
        <MenuItem key={o.slug} value={o.slug}>
          {o.name}
        </MenuItem>
      ))}
    </TextField>
  );

  const device = system?.device;

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("settings.title")}
      </SectionHeading>
      {loading ? (
        <LoadingIndicator label={t("loading.settings")} />
      ) : (
      <Stack spacing={3}>
        <TextField
          label={t("settings.hfToken")}
          type="password"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setSaved(false);
          }}
          helperText={t("settings.hfTokenHelp")}
          autoComplete="off"
        />

        <Divider />

        <Box>
          <SectionHeading level={3} variant="subtitle2" sx={{ mb: 1 }}>
            {t("settings.performance.title")}
          </SectionHeading>
          <Stack>
            <PerfSwitch
              label={t("settings.performance.vaeTiling")}
              help={t("settings.performance.vaeTilingHelp")}
              checked={perf.vae_tiling}
              onChange={setFlag("vae_tiling")}
            />
            <PerfSwitch
              label={t("settings.performance.vaeSlicing")}
              help={t("settings.performance.vaeSlicingHelp")}
              checked={perf.vae_slicing}
              onChange={setFlag("vae_slicing")}
            />
            <PerfSwitch
              label={t("settings.performance.xformers")}
              help={t("settings.performance.xformersHelp")}
              checked={perf.xformers}
              onChange={setFlag("xformers")}
            />
            <PerfSwitch
              label={t("settings.performance.torchCompile")}
              help={t("settings.performance.torchCompileHelp")}
              checked={perf.torch_compile}
              onChange={setFlag("torch_compile")}
            />
            <TextField
              label={t("settings.performance.sdX4Steps")}
              helperText={t("settings.performance.sdX4StepsHelp")}
              type="number"
              value={sdX4Steps}
              onChange={(e) => {
                setSdX4Steps(Number(e.target.value));
                setSaved(false);
              }}
              inputProps={{ min: 1, max: 150, step: 1 }}
              sx={{ mt: 2, maxWidth: 220 }}
            />
          </Stack>
        </Box>

        <Divider />

        <Box>
          <SectionHeading level={3} variant="subtitle2" sx={{ mb: 1 }}>
            {t("settings.outpaint.title")}
          </SectionHeading>
          <TextField
            label={t("settings.outpaint.negativeLabel")}
            helperText={t("settings.outpaint.negativeHelp")}
            value={outpaintNegative}
            onChange={(e) => {
              setOutpaintNegative(e.target.value);
              setSaved(false);
            }}
            multiline
            minRows={2}
            fullWidth
          />
        </Box>

        <Divider />

        <Box>
          <SectionHeading level={3} variant="subtitle2" sx={{ mb: 1 }}>
            {t("settings.defaults.title")}
          </SectionHeading>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            {t("settings.defaults.help")}
          </Typography>
          <Stack spacing={2}>
            {defaultSelect(t("settings.defaults.model"), defModel, setDefModel, downloadedModels)}
            {defaultSelect(
              t("settings.defaults.upscaler"),
              defUpscaler,
              setDefUpscaler,
              downloadedUpscalers,
            )}
            {defaultSelect(
              t("settings.defaults.outpaint"),
              defOutpaint,
              setDefOutpaint,
              downloadedOutpaint,
            )}
          </Stack>
        </Box>

        <Box>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {t("common.error")}
            </Alert>
          )}
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saved ? t("settings.saved") : t("settings.save")}
          </Button>
        </Box>

        <Divider />

        <Box>
          <SectionHeading level={3} variant="subtitle2" sx={{ mb: 1 }}>
            {t("settings.system")}
          </SectionHeading>
          <Stack spacing={0.5}>
            <InfoRow
              label={t("settings.backend")}
              value={device?.torch_available ? device.backend : t("settings.torchMissing")}
            />
            {device?.gpu_name && <InfoRow label={t("settings.gpu")} value={device.gpu_name} />}
            {system && <InfoRow label={t("settings.modelsDir")} value={system.models_dir} />}
          </Stack>
        </Box>
      </Stack>
      )}
    </Paper>
  );
}
