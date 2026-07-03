"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { SystemInfo } from "@/types";

interface SettingsPanelProps {
  system: SystemInfo | null;
}

function InfoRow({ label, value }: { label: string; value: string }) {
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

export function SettingsPanel({ system }: SettingsPanelProps) {
  const t = useTranslations();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => setToken(s.hf_token ?? ""));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveSettings({ hf_token: token.trim() === "" ? null : token.trim() });
      setSaved(true);
    } finally {
      setSaving(false);
    }
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

        <Box>
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
