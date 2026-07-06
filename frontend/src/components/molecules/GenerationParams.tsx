"use client";

import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { InfoTip } from "@/components/molecules/InfoTip";
import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { useTranslations } from "@/i18n";

/** Optional sampler dropdown; omitted (FLUX/edit) → no sampler control. */
interface SamplerControl {
  list: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}

/** Optional hires-refine toggle + step count; omitted (edit) → no refine controls. */
interface RefineControl {
  checked: boolean;
  onChange: (on: boolean) => void;
  steps: number;
  onSteps: (n: number) => void;
}

interface GenerationParamsProps {
  /** i18n key prefix, e.g. "reframe.params" | "inpaint.params" | "edit.params".
   *  All labels/help read from `${keyPrefix}.<field>`(+`Help`). */
  keyPrefix: string;
  steps: number;
  onSteps: (n: number) => void;
  guidance: number;
  onGuidance: (n: number) => void;
  /** Guidance slider cap (Kontext edit wants ~10, SD/FLUX outpaint 30). */
  guidanceMax?: number;
  batch: number;
  onBatch: (n: number) => void;
  seed: string;
  onSeed: (value: string) => void;
  sampler?: SamplerControl;
  refine?: RefineControl;
}

/**
 * The generation-parameters block shared by the Reframe/Inpaint/Edit panels:
 * (optional sampler) · steps · (optional hires-refine toggle + steps) · guidance ·
 * batch · seed. Presentational — the panel owns the state and passes values +
 * setters; i18n keys are derived from `keyPrefix` so each screen keeps its own copy.
 */
export const GenerationParams = ({
  keyPrefix,
  steps,
  onSteps,
  guidance,
  onGuidance,
  guidanceMax = 30,
  batch,
  onBatch,
  seed,
  onSeed,
  sampler,
  refine,
}: GenerationParamsProps) => {
  const t = useTranslations();
  const k = (name: string) => t(`${keyPrefix}.${name}`);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
        <Typography variant="subtitle2">{k("title")}</Typography>
        <InfoTip text={k("help")} />
      </Box>
      <Stack spacing={1.5}>
        {sampler && (
          <TextField
            select
            size="small"
            label={k("sampler")}
            value={sampler.list.some((s) => s.id === sampler.value) ? sampler.value : ""}
            onChange={(e) => sampler.onChange(e.target.value)}
            helperText={k("samplerHelp")}
          >
            {sampler.list.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
        )}
        <LabeledSlider
          label={k("steps")}
          info={k("stepsHelp")}
          value={steps}
          min={1}
          max={150}
          onChange={onSteps}
        />
        {refine && (
          <>
            <Box>
              <FormControlLabel
                control={
                  <Switch checked={refine.checked} onChange={(e) => refine.onChange(e.target.checked)} />
                }
                label={
                  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                    {k("refine")}
                    <InfoTip text={k("refineHelp")} sx={{ fontSize: 16 }} />
                  </Box>
                }
              />
            </Box>
            {refine.checked && (
              <LabeledSlider
                label={k("refineSteps")}
                info={k("refineStepsHelp")}
                value={refine.steps}
                min={1}
                max={150}
                onChange={refine.onSteps}
              />
            )}
          </>
        )}
        <LabeledSlider
          label={k("guidance")}
          info={k("guidanceHelp")}
          value={guidance}
          min={0}
          max={guidanceMax}
          step={0.5}
          onChange={onGuidance}
        />
        <LabeledSlider
          label={k("batch")}
          info={k("batchHelp")}
          value={batch}
          min={1}
          max={8}
          onChange={onBatch}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <TextField
            size="small"
            label={k("seed")}
            placeholder={k("seedPlaceholder")}
            type="number"
            value={seed}
            onChange={(e) => onSeed(e.target.value)}
            sx={{ flexGrow: 1 }}
          />
          <InfoTip text={k("seedHelp")} />
        </Box>
      </Stack>
    </Box>
  );
};
