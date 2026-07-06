"use client";

import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useEffect, useState } from "react";

import { useTranslations } from "@/i18n";
import type { CompareAxis, CompareParam, Sampler } from "@/types";

// Parameters that carry numeric values (comma/space separated) vs the sampler axis,
// which picks from the sampler list.
const NUMERIC: CompareParam[] = ["steps", "guidance_scale", "seed"];

interface AxisEditorProps {
  axis: CompareAxis;
  /** Whitelist params still selectable for this axis (others are used elsewhere). */
  paramOptions: CompareParam[];
  samplers: Sampler[];
  onChange: (axis: CompareAxis) => void;
  onRemove: () => void;
  removable: boolean;
}

/**
 * Edits one XYZ-plot axis: a swept parameter + its list of values. Numeric params
 * (steps/guidance/seed) take a comma-separated field parsed into number chips;
 * the sampler param adds from a dropdown of not-yet-chosen samplers. Presentational
 * — the parsed axis is pushed up via `onChange`.
 */
export const AxisEditor = ({
  axis,
  paramOptions,
  samplers,
  onChange,
  onRemove,
  removable,
}: AxisEditorProps) => {
  const t = useTranslations();
  const isNumeric = NUMERIC.includes(axis.param);

  // Local raw text for the numeric field so a trailing comma / half-typed number
  // survives while editing; the parsed numbers are propagated up.
  const [text, setText] = useState(() => axis.values.join(", "));
  // Re-seed when the axis param switches (values reset to a different type).
  useEffect(() => {
    if (isNumeric) setText(axis.values.join(", "));
  }, [axis.param]); // eslint-disable-line react-hooks/exhaustive-deps

  const onParam = (param: CompareParam) => {
    setText("");
    onChange({ param, values: [] });
  };

  const onNumericText = (raw: string) => {
    setText(raw);
    const values = raw
      .split(/[,\s]+/)
      .map((tok) => tok.trim())
      .filter((tok) => tok !== "" && !Number.isNaN(Number(tok)))
      .map(Number);
    onChange({ ...axis, values });
  };

  const addSampler = (id: string) => {
    if (id && !axis.values.includes(id)) onChange({ ...axis, values: [...axis.values, id] });
  };

  const removeSampler = (id: string) =>
    onChange({ ...axis, values: axis.values.filter((v) => v !== id) });

  const samplerLabel = (id: string) => samplers.find((s) => s.id === id)?.label ?? id;
  const unusedSamplers = samplers.filter((s) => !axis.values.includes(s.id));

  return (
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "auto 1fr auto" }, alignItems: "start" }}>
      <TextField
        select
        size="small"
        label={t("compare.axis.param")}
        value={axis.param}
        onChange={(e) => onParam(e.target.value as CompareParam)}
        sx={{ minWidth: { xs: "100%", sm: 150 } }}
      >
        {paramOptions.map((p) => (
          <MenuItem key={p} value={p}>
            {t(`compare.param.${p}`)}
          </MenuItem>
        ))}
      </TextField>

      {isNumeric ? (
        <TextField
          size="small"
          label={t("compare.axis.values")}
          placeholder={t(`compare.placeholder.${axis.param}`)}
          helperText={t("compare.axis.valuesHelp")}
          value={text}
          onChange={(e) => onNumericText(e.target.value)}
          fullWidth
        />
      ) : (
        <Box>
          <TextField
            select
            size="small"
            label={t("compare.axis.addSampler")}
            value=""
            onChange={(e) => addSampler(e.target.value)}
            fullWidth
            disabled={unusedSamplers.length === 0}
          >
            {unusedSamplers.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          {axis.values.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>
              {axis.values.map((v) => (
                <Chip
                  key={String(v)}
                  label={samplerLabel(String(v))}
                  size="small"
                  onDelete={() => removeSampler(String(v))}
                />
              ))}
            </Stack>
          )}
        </Box>
      )}

      <IconButton
        aria-label={t("compare.axis.remove")}
        onClick={onRemove}
        disabled={!removable}
        sx={{ justifySelf: { xs: "end", sm: "center" } }}
      >
        <DeleteOutlineIcon />
      </IconButton>
    </Box>
  );
};
