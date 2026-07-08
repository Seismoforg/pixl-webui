"use client";

import AddIcon from "@mui/icons-material/Add";
import ClearIcon from "@mui/icons-material/Clear";
import GridViewIcon from "@mui/icons-material/GridView";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { MonoText } from "@/components/atoms/MonoText";
import { SectionHeading } from "@/components/atoms/SectionHeading";
import { AxisEditor } from "@/components/molecules/AxisEditor";
import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { CompareResult } from "@/components/organisms/CompareResult";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { formLockStyle } from "@/lib/formLock";
import { formCardSx } from "@/lib/formCard";
import { stickyActionBarSx } from "@/lib/stickyActionBar";
import { supportsSamplerChoice } from "@/lib/modelFamily";
import { useAppData } from "@/providers/AppDataProvider";
import { useCompare } from "@/providers/CompareProvider";
import type { CompareAxis, CompareParam, PromptValue, Sampler } from "@/types";

// The sweepable parameters (mirrors the backend whitelist in routers/compare.py).
// "sampler" is dropped for flow-matching families (FLUX / SD 3.x) where it has no effect.
const ALL_PARAMS: CompareParam[] = ["steps", "guidance_scale", "sampler", "seed", "prompt"];
// Mirrors MAX_CELLS in routers/compare.py — the grid is capped to this many images.
const MAX_CELLS = 64;

/** Valid values for an axis: drop empty numeric fields / empty prompt pairs so
 *  half-typed rows don't count toward the grid or reach the backend. */
const cleanValues = (axis: CompareAxis): CompareAxis["values"] => {
  if (axis.param === "prompt")
    return (axis.values as PromptValue[]).filter((v) => v && v.prompt.trim() !== "");
  if (axis.param === "sampler") return axis.values.filter((v) => v !== "");
  return (axis.values as number[]).filter((v) => typeof v === "number" && !Number.isNaN(v));
};

export const ComparePanel = () => {
  const t = useTranslations();
  const { models, modelsLoading, modelsError } = useAppData();
  const compare = useCompare();
  const {
    slug,
    prompt,
    negative,
    width,
    height,
    steps,
    guidance,
    seed,
    sampler,
    axes,
    saveIndividuals,
    setSlug,
    setPrompt,
    setNegative,
    setWidth,
    setHeight,
    setSteps,
    setGuidance,
    setSeed,
    setSampler,
    setAxes,
    setSaveIndividuals,
    running,
    error: jobError,
  } = compare;

  const [samplers, setSamplers] = useState<Sampler[]>([]);
  useEffect(() => {
    api
      .getSamplers()
      .then((s) => setSamplers(s.samplers))
      .catch(() => setSamplers([]));
  }, []);

  const downloaded = models.filter((m) => m.downloaded);

  // Default the model to the first downloaded one once loaded.
  useEffect(() => {
    if (slug === "" && downloaded.length > 0) setSlug(downloaded[0].slug);
  }, [downloaded, slug, setSlug]);

  // The sampler is inert on flow-matching families (FLUX / SD 3.x): hide the base
  // control and drop it from the sweepable set.
  const family = downloaded.find((m) => m.slug === slug)?.family;
  const samplerSupported = supportsSamplerChoice(family);
  const whitelist = samplerSupported ? ALL_PARAMS : ALL_PARAMS.filter((p) => p !== "sampler");

  // If the model switches to a family where the sampler is inert, drop any live
  // sampler axis (keep at least one axis so the form stays usable).
  useEffect(() => {
    if (samplerSupported || !axes.some((a) => a.param === "sampler")) return;
    const next = axes.filter((a) => a.param !== "sampler");
    setAxes(next.length > 0 ? next : [{ param: "steps", values: [] }]);
  }, [samplerSupported, axes, setAxes]);

  const activeAxes = axes
    .map((a) => ({ ...a, values: cleanValues(a) }))
    .filter((a) => a.values.length > 0);
  const cellCount = activeAxes.reduce((n, a) => n * a.values.length, 1);
  const overCap = activeAxes.length > 0 && cellCount > MAX_CELLS;

  // A parameter swept as an axis is overridden per cell, so its base control is hidden.
  const sweptParams = new Set(axes.map((a) => a.param));
  const promptSwept = sweptParams.has("prompt");
  // When prompt is swept, the base prompt/negative are hidden; the first swept pair
  // stands in as the request's base prompt (every cell overrides it anyway).
  const firstPromptValue = promptSwept
    ? (activeAxes.find((a) => a.param === "prompt")?.values[0] as PromptValue | undefined)
    : undefined;
  const effPrompt = promptSwept ? (firstPromptValue?.prompt ?? "") : prompt;
  const effNegative = promptSwept ? (firstPromptValue?.negative ?? "") : negative;

  const canRun = !!slug && effPrompt.trim() !== "" && activeAxes.length > 0 && !overCap && !running;

  const usedElsewhere = (index: number, param: CompareParam) =>
    axes.some((a, j) => j !== index && a.param === param);
  const optionsFor = (index: number) =>
    whitelist.filter((p) => p === axes[index].param || !usedElsewhere(index, p));
  const freeParam = () => whitelist.find((p) => !axes.some((a) => a.param === p));

  const addAxis = () => {
    const param = freeParam();
    if (param && axes.length < 3) setAxes([...axes, { param, values: [] }]);
  };
  const updateAxis = (index: number, next: (typeof axes)[number]) =>
    setAxes(axes.map((a, j) => (j === index ? next : a)));
  const removeAxis = (index: number) => setAxes(axes.filter((_, j) => j !== index));

  const handleRun = () => {
    if (!canRun) return;
    compare.start({
      slug,
      prompt: effPrompt,
      negative_prompt: effNegative.trim() === "" ? null : effNegative,
      width,
      height,
      steps,
      guidance_scale: guidance,
      seed: seed.trim() === "" ? null : Number(seed),
      sampler,
      axes: activeAxes,
      save_individuals: saveIndividuals,
    });
  };

  const handleClear = () => {
    setPrompt("");
    setAxes([{ param: "steps", values: [] }]);
    compare.reset();
  };

  const canAddAxis = axes.length < 3 && freeParam() !== undefined && !running;

  return (
    <Box>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("compare.title")}
      </SectionHeading>

      {jobError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {jobError}
        </Alert>
      )}

      {modelsLoading && models.length === 0 ? (
        <LoadingIndicator label={t("loading.models")} />
      ) : modelsError ? (
        <Alert severity="error">{t("models.loadError")}</Alert>
      ) : downloaded.length === 0 ? (
        <Alert severity="info">{t("generate.noModelDownloaded")}</Alert>
      ) : (
        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            alignItems: "start",
          }}
        >
          <Stack spacing={3} sx={formCardSx}>
            <fieldset disabled={running} style={formLockStyle(running)}>
              <Stack spacing={3}>
                {/* Model + prompt */}
                <TextField
                  select
                  size="small"
                  label={t("compare.model")}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  fullWidth
                >
                  {downloaded.map((m) => (
                    <MenuItem key={m.slug} value={m.slug}>
                      {m.name}
                    </MenuItem>
                  ))}
                </TextField>

                {/* Base prompt hidden when the prompt is swept as an axis (overridden per cell) */}
                {!promptSwept && (
                  <>
                    <TextField
                      fullWidth
                      multiline
                      minRows={2}
                      size="small"
                      label={t("compare.prompt")}
                      placeholder={t("generate.promptPlaceholder")}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                    <TextField
                      fullWidth
                      multiline
                      minRows={1}
                      size="small"
                      label={t("compare.negative")}
                      value={negative}
                      onChange={(e) => setNegative(e.target.value)}
                    />
                  </>
                )}

                {/* Axes */}
                <Box>
                  <SectionHeading level={3} sx={{ mb: 0.5 }}>
                    {t("compare.axes.title")}
                  </SectionHeading>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {t("compare.axes.help")}
                  </Typography>
                  <Stack spacing={2}>
                    {axes.map((axis, i) => (
                      <AxisEditor
                        key={i}
                        axis={axis}
                        paramOptions={optionsFor(i)}
                        samplers={samplers}
                        onChange={(next) => updateAxis(i, next)}
                        onRemove={() => removeAxis(i)}
                        removable={axes.length > 1}
                      />
                    ))}
                  </Stack>
                  <Button
                    startIcon={<AddIcon />}
                    size="small"
                    onClick={addAxis}
                    disabled={!canAddAxis}
                    sx={{ mt: 1.5 }}
                  >
                    {t("compare.axes.add")}
                  </Button>
                </Box>

                {/* Base parameters (used for whatever isn't swept) */}
                <Box>
                  <SectionHeading level={3} sx={{ mb: 0.5 }}>
                    {t("compare.base.title")}
                  </SectionHeading>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {t("compare.base.help")}
                  </Typography>
                  <Stack spacing={2}>
                    {samplerSupported && !sweptParams.has("sampler") && (
                      <TextField
                        select
                        size="small"
                        label={t("compare.base.sampler")}
                        value={samplers.some((s) => s.id === sampler) ? sampler : ""}
                        onChange={(e) => setSampler(e.target.value)}
                        fullWidth
                      >
                        {samplers.map((s) => (
                          <MenuItem key={s.id} value={s.id}>
                            {s.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                    {!sweptParams.has("steps") && (
                      <LabeledSlider
                        label={t("compare.base.steps")}
                        value={steps}
                        min={1}
                        max={150}
                        onChange={setSteps}
                      />
                    )}
                    {!sweptParams.has("guidance_scale") && (
                      <LabeledSlider
                        label={t("compare.base.guidance")}
                        value={guidance}
                        min={0}
                        max={30}
                        step={0.5}
                        onChange={setGuidance}
                      />
                    )}
                    <Box sx={{ display: "flex", gap: 2 }}>
                      <TextField
                        type="number"
                        size="small"
                        label={t("compare.base.width")}
                        value={width}
                        onChange={(e) =>
                          setWidth(Math.max(128, Math.min(2048, Number(e.target.value) || 128)))
                        }
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        type="number"
                        size="small"
                        label={t("compare.base.height")}
                        value={height}
                        onChange={(e) =>
                          setHeight(Math.max(128, Math.min(2048, Number(e.target.value) || 128)))
                        }
                        sx={{ flex: 1 }}
                      />
                    </Box>
                    {!sweptParams.has("seed") && (
                      <TextField
                        size="small"
                        label={t("compare.base.seed")}
                        placeholder={t("generate.seedPlaceholder")}
                        value={seed}
                        onChange={(e) => setSeed(e.target.value)}
                        fullWidth
                      />
                    )}
                  </Stack>
                </Box>

                {/* Also persist each individual cell image to the gallery */}
                <FormControlLabel
                  control={
                    <Switch
                      checked={saveIndividuals}
                      onChange={(e) => setSaveIndividuals(e.target.checked)}
                    />
                  }
                  label={t("compare.saveIndividuals")}
                />
              </Stack>
            </fieldset>

            {/* Cell count + cap warning */}
            {activeAxes.length > 0 &&
              (overCap ? (
                <Alert severity="warning">
                  {t("compare.tooMany", { count: cellCount, max: MAX_CELLS })}
                </Alert>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("compare.cellCount")
                    .split(/(\{count\})/)
                    .map((part, i) =>
                      part === "{count}" ? <MonoText key={i}>{cellCount}</MonoText> : part,
                    )}
                </Typography>
              ))}

            <Stack direction="row" spacing={1} sx={stickyActionBarSx}>
              <Button
                variant="contained"
                size="large"
                startIcon={<GridViewIcon />}
                onClick={handleRun}
                disabled={!canRun}
                sx={{ flexGrow: 1 }}
              >
                {running ? t("compare.running") : t("compare.run")}
              </Button>
              <Button
                variant="outlined"
                size="large"
                startIcon={<ClearIcon />}
                onClick={handleClear}
                disabled={running}
              >
                {t("compare.clear")}
              </Button>
            </Stack>
          </Stack>

          <CompareResult />
        </Box>
      )}
    </Box>
  );
};
