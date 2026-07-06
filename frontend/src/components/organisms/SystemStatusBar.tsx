"use client";

import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { MonoText } from "@/components/atoms/MonoText";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useLive } from "@/lib/ws";
import type { ResourceStats } from "@/types";

/** Compact live resource meter shown on every page, under the tab bar. */
export const SystemStatusBar = () => {
  const t = useTranslations();
  const [stats, setStats] = useState<ResourceStats | null>(null);

  // Live via WebSocket; falls back to REST polling while the socket is down.
  useLive<ResourceStats>(
    "system",
    { channel: "system" },
    setStats,
    { fetch: api.getSystemStats, intervalMs: 2000 },
  );

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
      {/* CSS grid (not a flex-wrap Stack): even gaps, tidy 2x2 on mobile, one row
          from sm up. Cells are minWidth:0 so values never force overflow. */}
      <Box
        role="group"
        aria-label={t("status.title")}
        sx={{
          display: "grid",
          columnGap: { xs: 2, sm: 3 },
          rowGap: 1,
          gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" },
        }}
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
      </Box>
    </Box>
  );
}

const Meter = ({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number | null;
  detail?: string;
}) => {
  const t = useTranslations();
  const value = percent ?? 0;
  const shown = percent != null ? `${Math.round(percent)}%` : t("status.na");

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: { xs: 0.5, sm: 2 },
          mb: 0.25,
          minWidth: 0,
        }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
        >
          {label}
        </Typography>
        <MonoText variant="caption" fontWeight="medium" sx={{ whiteSpace: "nowrap" }}>
          {detail ?? shown}
        </MonoText>
      </Box>
      <LinearProgress
        variant="determinate"
        value={percent != null ? Math.min(100, value) : 0}
        aria-label={label}
        sx={{
          height: 5,
          borderRadius: 2.5,
          bgcolor: "action.hover",
          "& .MuiLinearProgress-bar": { borderRadius: 2.5 },
        }}
      />
    </Box>
  );
}
