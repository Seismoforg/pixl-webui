"use client";

import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import { useId } from "react";

import { InfoTip } from "@/components/molecules/InfoTip";

interface LabeledSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  info?: string;
  onChange: (value: number) => void;
}

export function LabeledSlider({
  label,
  value,
  min,
  max,
  step = 1,
  info,
  onChange,
}: LabeledSliderProps) {
  const labelId = useId();

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Typography id={labelId} variant="body2" color="text.secondary">
            {label}
          </Typography>
          {info && <InfoTip text={info} sx={{ fontSize: 16 }} />}
        </Box>
        <Typography variant="body2" fontWeight="medium">
          {value}
        </Typography>
      </Box>
      <Slider
        aria-labelledby={labelId}
        value={value}
        min={min}
        max={max}
        step={step}
        valueLabelDisplay="auto"
        onChange={(_, next) => onChange(next as number)}
      />
    </Box>
  );
}
