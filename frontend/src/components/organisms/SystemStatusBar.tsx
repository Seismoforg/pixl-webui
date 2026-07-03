"use client";

import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import type { ResourceStats } from "@/types";

const POLL_MS = 2000;

/** Compact live resource meter shown on every page, under the tab bar. */
export function SystemStatusBar() {
  const t = useTranslations();
  const [stats, setStats] = useState<ResourceStats | null>(null);

  useEffect(() => {
    let active = true;
    const tick = () => {
      api
        .getSystemStats()
        .then((s) => active && setStats(s))
        .catch(() => active && setStats(null));
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (!stats) return null;

  return (
    <Box
      sx={{
        px: 2,
        py: 0.75,
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Stack
        direction="row"
        spacing={{ xs: 2, sm: 3 }}
        sx={{ flexWrap: "wrap", rowGap: 0.5 }}
        aria-label={t("status.title")}
      >
        <Meter label={t("status.cpu")} percent={stats.cpu_percent} />
        <Meter
          label={t("status.ram")}
          percent={stats.ram_percent}
          detail={`${stats.ram_used_gb} / ${stats.ram_total_gb} GB`}
        />
        <Meter label={t("status.gpu")} percent={stats.gpu_percent} />
        <Meter
          label={t("status.vram")}
          percent={stats.vram_percent}
          detail={
            stats.vram_total_gb != null
              ? `${stats.vram_used_gb} / ${stats.vram_total_gb} GB`
              : t("status.na")
          }
        />
      </Stack>
    </Box>
  );
}

function Meter({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number | null;
  detail?: string;
}) {
  const t = useTranslations();
  const value = percent ?? 0;
  const shown = percent != null ? `${Math.round(percent)}%` : t("status.na");

  return (
    <Box sx={{ minWidth: 120 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="caption" fontWeight="medium">
          {detail ?? shown}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={percent != null ? Math.min(100, value) : 0}
        sx={{ height: 4, borderRadius: 2 }}
      />
    </Box>
  );
}
