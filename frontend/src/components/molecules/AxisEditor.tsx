"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";

import { useTranslations } from "@/i18n";
import type { CompareAxis, CompareParam, PromptValue, Sampler } from "@/types";

// Parameters that carry a single numeric value per row (vs sampler ids / prompt pairs).
const NUMERIC: CompareParam[] = ["steps", "guidance_scale", "seed"];

/** Per-param numeric input constraints (min/step) for the value fields. */
const NUMERIC_INPUT: Record<string, { min: number; step: number }> = {
  steps: { min: 1, step: 1 },
  seed: { min: 0, step: 1 },
  guidance_scale: { min: 0, step: 0.5 },
};

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
 * Edits one XYZ-plot axis: a swept parameter + a list of values, one row per value
 * with the right control for the type — a number field (steps/guidance/seed), a
 * sampler dropdown, or a positive+negative prompt pair. An "Add value" button appends
 * a row; each row removes itself. Presentational — the axis is pushed up via `onChange`.
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
  const isPrompt = axis.param === "prompt";

  const setValues = (values: CompareAxis["values"]) => onChange({ ...axis, values });
  const updateValue = (index: number, value: CompareAxis["values"][number]) =>
    setValues(axis.values.map((v, j) => (j === index ? value : v)));
  const removeValue = (index: number) => setValues(axis.values.filter((_, j) => j !== index));

  const unusedSamplers = (current?: string) =>
    samplers.filter((s) => s.id === current || !axis.values.includes(s.id));

  const defaultValue = (): CompareAxis["values"][number] => {
    if (isPrompt) return { prompt: "", negative: "" };
    if (axis.param === "sampler") return unusedSamplers()[0]?.id ?? "";
    return Number.NaN;
  };

  const onParam = (param: CompareParam) => onChange({ param, values: [] });

  const addValue = () => setValues([...axis.values, defaultValue()]);
  const canAddSampler = axis.param !== "sampler" || unusedSamplers().length > 0;

  const numInput = NUMERIC_INPUT[axis.param];

  return (
    <Box
      sx={{
        display: "grid",
        gap: 1.5,
        gridTemplateColumns: { xs: "1fr", sm: "auto 1fr" },
        alignItems: "start",
      }}
    >
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

      <Stack spacing={1}>
        {axis.values.map((value, i) => (
          <Box key={i} sx={{ display: "grid", gap: 1, gridTemplateColumns: "1fr auto" }}>
            {isPrompt ? (
              <Stack spacing={1}>
                <TextField
                  size="small"
                  multiline
                  minRows={1}
                  label={t("compare.axis.pos")}
                  value={(value as PromptValue).prompt}
                  onChange={(e) =>
                    updateValue(i, { ...(value as PromptValue), prompt: e.target.value })
                  }
                  fullWidth
                />
                <TextField
                  size="small"
                  multiline
                  minRows={1}
                  label={t("compare.axis.neg")}
                  value={(value as PromptValue).negative}
                  onChange={(e) =>
                    updateValue(i, { ...(value as PromptValue), negative: e.target.value })
                  }
                  fullWidth
                />
              </Stack>
            ) : isNumeric ? (
              <TextField
                size="small"
                type="number"
                inputProps={{ ...numInput, "aria-label": `${t("compare.axis.value")} ${i + 1}` }}
                value={Number.isNaN(value as number) ? "" : (value as number)}
                onChange={(e) =>
                  updateValue(i, e.target.value === "" ? Number.NaN : Number(e.target.value))
                }
                fullWidth
              />
            ) : (
              <TextField
                select
                size="small"
                inputProps={{ "aria-label": `${t("compare.axis.value")} ${i + 1}` }}
                value={value as string}
                onChange={(e) => updateValue(i, e.target.value)}
                fullWidth
              >
                {unusedSamplers(value as string).map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <IconButton
              aria-label={t("compare.axis.removeValue")}
              onClick={() => removeValue(i)}
              size="small"
              sx={{ mt: 0.25 }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}

        <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
          <Button startIcon={<AddIcon />} size="small" onClick={addValue} disabled={!canAddSampler}>
            {t("compare.axis.addValue")}
          </Button>
          <IconButton
            aria-label={t("compare.axis.remove")}
            onClick={onRemove}
            disabled={!removable}
            size="small"
          >
            <DeleteOutlineIcon />
          </IconButton>
        </Stack>
      </Stack>
    </Box>
  );
};
