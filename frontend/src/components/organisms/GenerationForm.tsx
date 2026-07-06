"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { InfoTip } from "@/components/molecules/InfoTip";
import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { PromptSnippets } from "@/components/organisms/PromptSnippets";
import { ReferenceImage } from "@/components/organisms/ReferenceImage";
import { useGeneration } from "@/providers/GenerationProvider";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { formLockStyle } from "@/lib/formLock";
import type { ModelEntry, PromptSnippet } from "@/types";

interface GenerationFormProps {
  downloaded: ModelEntry[];
}

const appendPrompt = (current: string, addition: string): string =>
  current.trim() === "" ? addition : `${current.trim()}, ${addition}`;

/** One labelled group of controls in the generation form. */
const FormSection = ({ title, children }: { title: string; children: ReactNode }) => {
  return (
    <Box component="section">
      <SectionHeading level={3} sx={{ mb: 1.5 }}>
        {title}
      </SectionHeading>
      <Stack spacing={2}>{children}</Stack>
    </Box>
  );
}

/** The generation form: model, prompts, reference image and parameters, grouped
 *  into labelled sections. Reads/writes the generation context. */
export const GenerationForm = ({ downloaded }: GenerationFormProps) => {
  const t = useTranslations();
  const gen = useGeneration();

  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const reloadSnippets = useCallback(() => {
    api.getPromptSnippets().then(setSnippets).catch(() => setSnippets([]));
  }, []);
  useEffect(() => reloadSnippets(), [reloadSnippets]);

  const positiveSnippets = useMemo(
    () => snippets.filter((s) => s.kind === "positive"),
    [snippets],
  );
  const negativeSnippets = useMemo(
    () => snippets.filter((s) => s.kind === "negative"),
    [snippets],
  );

  // The IP-Adapter "style" mode only works on SD 1.5 / SDXL.
  const styleSupported = useMemo(() => {
    const fam = downloaded.find((m) => m.slug === gen.slug)?.family;
    return fam === "SD 1.5" || fam === "SDXL";
  }, [downloaded, gen.slug]);

  // Flow-matching families (FLUX / SD 3.x) keep their native scheduler, so the
  // sampler selection has no effect — hide the control for them.
  const samplerSupported = useMemo(() => {
    const fam = downloaded.find((m) => m.slug === gen.slug)?.family;
    return fam !== "FLUX" && fam !== "SD 3.x";
  }, [downloaded, gen.slug]);

  const canSubmit = !gen.running && gen.prompt.trim() !== "";
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) gen.generate();
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack spacing={3} component="form" onSubmit={handleSubmit}>
        {/* Lock every control while a job runs so params can't change mid-run.
            fieldset[disabled] blocks native inputs + keyboard; pointer-events
            also locks the (span-driven) MUI sliders. */}
        <fieldset disabled={gen.running} style={formLockStyle(gen.running)}>
          <Stack spacing={3}>
        <FormSection title={t("generate.sections.model")}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <TextField
              select
              label={t("generate.model")}
              value={gen.slug}
              onChange={(e) => gen.changeModel(e.target.value)}
              sx={{ flexGrow: 1 }}
            >
              {downloaded.map((m) => (
                <MenuItem key={m.slug} value={m.slug}>
                  {m.name}
                </MenuItem>
              ))}
            </TextField>
            <InfoTip text={t("generate.info.model")} />
          </Box>
        </FormSection>

        <Divider />

        <FormSection title={t("generate.sections.prompt")}>
          <Box>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
              <TextField
                label={t("generate.prompt")}
                placeholder={t("generate.promptPlaceholder")}
                value={gen.prompt}
                onChange={(e) => gen.setPrompt(e.target.value)}
                multiline
                minRows={2}
                required
                fullWidth
              />
              <InfoTip text={t("generate.info.prompt")} sx={{ mt: 1 }} />
            </Box>
            <PromptSnippets
              kind="positive"
              snippets={positiveSnippets}
              currentText={gen.prompt}
              onApply={(text) => gen.setPrompt(appendPrompt(gen.prompt, text))}
              onChanged={reloadSnippets}
            />
          </Box>

          <Box>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
              <TextField
                label={t("generate.negativePrompt")}
                value={gen.negative}
                onChange={(e) => gen.setNegative(e.target.value)}
                multiline
                minRows={2}
                fullWidth
              />
              <InfoTip text={t("generate.info.negativePrompt")} sx={{ mt: 1 }} />
            </Box>
            <PromptSnippets
              kind="negative"
              snippets={negativeSnippets}
              currentText={gen.negative}
              onApply={(text) => gen.setNegative(appendPrompt(gen.negative, text))}
              onChanged={reloadSnippets}
            />
          </Box>
        </FormSection>

        <Divider />

        <Box component="section">
          <ReferenceImage styleSupported={styleSupported} />
        </Box>

        <Divider />

        <FormSection title={t("generate.sections.parameters")}>
          {samplerSupported && (
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
              <TextField
                select
                label={t("generate.sampler")}
                value={gen.sampler}
                onChange={(e) => gen.setSampler(e.target.value)}
                helperText={t("generate.samplerHint")}
                sx={{ flexGrow: 1 }}
              >
                {gen.samplers.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.label}
                  </MenuItem>
                ))}
              </TextField>
              <InfoTip text={t("generate.info.sampler")} sx={{ mt: 1.5 }} />
            </Box>
          )}

          <LabeledSlider
            label={t("generate.steps")}
            value={gen.steps}
            min={1}
            max={100}
            info={t("generate.info.steps")}
            onChange={gen.setSteps}
          />
          <LabeledSlider
            label={t("generate.guidance")}
            value={gen.guidance}
            min={0}
            max={20}
            step={0.5}
            info={t("generate.info.guidance")}
            onChange={gen.setGuidance}
          />
          <LabeledSlider
            label={t("generate.batch")}
            value={gen.batch}
            min={1}
            max={8}
            info={t("generate.info.batch")}
            onChange={gen.setBatch}
          />
        </FormSection>

        <Divider />

        <FormSection title={t("generate.sections.output")}>
          <Box sx={{ display: "flex", gap: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: 1 }}>
              <TextField
                label={t("generate.width")}
                type="number"
                value={gen.width}
                onChange={(e) => gen.setWidth(Number(e.target.value))}
                fullWidth
              />
              <InfoTip text={t("generate.info.size")} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: 1 }}>
              <TextField
                label={t("generate.height")}
                type="number"
                value={gen.height}
                onChange={(e) => gen.setHeight(Number(e.target.value))}
                fullWidth
              />
              <InfoTip text={t("generate.info.size")} />
            </Box>
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <TextField
              label={t("generate.seed")}
              placeholder={t("generate.seedPlaceholder")}
              type="number"
              value={gen.seed}
              onChange={(e) => gen.setSeed(e.target.value)}
              sx={{ flexGrow: 1 }}
            />
            <InfoTip text={t("generate.info.seed")} />
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={gen.preview}
                onChange={(e) => gen.setPreview(e.target.checked)}
              />
            }
            label={
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                {t("generate.livePreview")}
                <InfoTip text={t("generate.info.livePreview")} sx={{ fontSize: 16 }} />
              </Box>
            }
          />
        </FormSection>
          </Stack>
        </fieldset>

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={!canSubmit}
          startIcon={gen.running ? <CircularProgress size={18} color="inherit" /> : undefined}
        >
          {gen.running ? t("generate.running") : t("generate.run")}
        </Button>
      </Stack>
    </Paper>
  );
}
