"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { InfoTip } from "@/components/molecules/InfoTip";
import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { useTranslations } from "@/i18n";

interface BrushControlsProps {
  size: number;
  softness: number;
  onSize: (v: number) => void;
  onSoftness: (v: number) => void;
}

/** Brush size + softness sliders for the inpaint mask editor. */
export const BrushControls = ({ size, softness, onSize, onSoftness }: BrushControlsProps) => {
  const t = useTranslations();
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
        <Typography variant="subtitle2">{t("inpaint.brush.title")}</Typography>
        <InfoTip text={t("inpaint.brush.help")} />
      </Box>
      <Stack spacing={1.5}>
        <LabeledSlider
          label={t("inpaint.brush.size")}
          value={size}
          min={4}
          max={200}
          onChange={onSize}
        />
        <LabeledSlider
          label={t("inpaint.brush.softness")}
          info={t("inpaint.brush.softnessHelp")}
          value={softness}
          min={0}
          max={100}
          onChange={onSoftness}
        />
      </Stack>
    </Box>
  );
};
