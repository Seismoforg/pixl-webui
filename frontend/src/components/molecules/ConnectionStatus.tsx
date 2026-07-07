"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { useTranslations } from "@/i18n";
import { useLiveStatus } from "@/lib/ws";

/**
 * Small live-connection indicator (a colored dot + label) for the app bar, driven
 * by the shared WebSocket client's connection state. Green = live push; muted =
 * disconnected (the app then falls back to REST polling).
 */
export const ConnectionStatus = () => {
  const t = useTranslations();
  const connected = useLiveStatus();

  const label = connected ? t("connection.live") : t("connection.offline");
  const tip = connected ? t("connection.liveHint") : t("connection.offlineHint");

  return (
    <Tooltip title={tip}>
      <Box
        role="status"
        aria-label={label}
        sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 0.5 }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            // Filled disc when live, hollow ring when offline — a shape difference
            // (not just color) so the status reads without relying on color vision.
            bgcolor: connected ? "success.main" : "transparent",
            border: connected ? "none" : (theme) => `1.5px solid ${theme.palette.text.secondary}`,
            boxShadow: connected ? (theme) => `0 0 0 3px ${theme.palette.success.main}22` : "none",
            flexShrink: 0,
          }}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: { xs: "none", sm: "block" } }}
        >
          {label}
        </Typography>
      </Box>
    </Tooltip>
  );
};
