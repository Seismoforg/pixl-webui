"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { AppSettings, SystemInfo } from "@/types";

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
  const [perf, setPerf] = useState({ vae_tiling: true, vae_slicing: true, xformers: true });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setToken(s.hf_token ?? "");
        setPerf({ vae_tiling: s.vae_tiling, vae_slicing: s.vae_slicing, xformers: s.xformers });
      })
      .catch(() => setError(true));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(false);
    try {
      const payload: AppSettings = {
        hf_token: token.trim() === "" ? null : token.trim(),
        ...perf,
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

  const device = system?.device;

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 560 }}>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("settings.title")}
      </SectionHeading>
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
    </Paper>
  );
}
