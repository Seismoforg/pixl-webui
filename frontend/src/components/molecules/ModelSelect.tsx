"use client";

import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import type { SxProps, Theme } from "@mui/material/styles";

import type { ModelEntry } from "@/types";

interface ModelSelectProps {
  models: ModelEntry[];
  value: string;
  onChange: (slug: string) => void;
  label: string;
  size?: "small" | "medium";
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
}

/** Downloaded-model dropdown shared by the generate + compare forms. */
export const ModelSelect = ({
  models,
  value,
  onChange,
  label,
  size,
  fullWidth,
  sx,
}: ModelSelectProps) => (
  <TextField
    select
    label={label}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    size={size}
    fullWidth={fullWidth}
    sx={sx}
  >
    {models.map((m) => (
      <MenuItem key={m.slug} value={m.slug}>
        {m.name}
      </MenuItem>
    ))}
  </TextField>
);
