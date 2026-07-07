"use client";

import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { useTranslations } from "@/i18n";
import { fitChipMeta } from "@/lib/fit";
import type { QuantLevel } from "@/types";

interface QuantSelectProps {
  levels: QuantLevel[]; // entry.quant_levels (empty → nothing rendered)
  value: string; // entry.load_level (effective level)
  suggested: string; // entry.suggested_level
  onChange: (level: string) => void;
  disabled?: boolean;
}

/**
 * Compact per-row load-time quantization picker (fp16 / int8 / NF4) for a model or
 * FLUX engine. Each option shows its estimated VRAM with a fit-colored dot and tags
 * the auto-suggested level; the closed field shows just the level id. Renders nothing
 * when no levels are offered (GGUF entry or bitsandbytes unavailable).
 */
export const QuantSelect = ({ levels, value, suggested, onChange, disabled }: QuantSelectProps) => {
  const t = useTranslations();
  if (levels.length === 0) return null;
  return (
    <TextField
      select
      size="small"
      label={t("quant.label")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      // Size to the (short) content — the closed field only shows the level id — and
      // never stretch to fill the row; hug the right edge when the row stacks (mobile).
      sx={{ width: 112, flexShrink: 0, alignSelf: { xs: "flex-end", md: "auto" } }}
      SelectProps={{ renderValue: (v) => t(`quant.level.${v as string}`) }}
    >
      {levels.map((l) => {
        const meta = fitChipMeta(l.verdict);
        return (
          <MenuItem key={l.level} value={l.level}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  bgcolor: `${meta.color}.main`,
                  flexShrink: 0,
                }}
              />
              <span>{t(`quant.level.${l.level}`)}</span>
              <Typography component="span" variant="caption" color="text.secondary">
                ≈ {l.est_vram_gb} GB{l.level === suggested ? ` · ${t("quant.suggested")}` : ""}
              </Typography>
            </Box>
          </MenuItem>
        );
      })}
    </TextField>
  );
};
