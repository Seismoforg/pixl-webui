"use client";

import AddIcon from "@mui/icons-material/Add";
import ClearIcon from "@mui/icons-material/Clear";
import GridViewIcon from "@mui/icons-material/GridView";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { MonoText } from "@/components/atoms/MonoText";
import { SectionHeading } from "@/components/atoms/SectionHeading";
import { AxisEditor } from "@/components/molecules/AxisEditor";
import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { CompareResult } from "@/components/organisms/CompareResult";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { formLockStyle } from "@/lib/formLock";
import { useAppData } from "@/providers/AppDataProvider";
import { useCompare } from "@/providers/CompareProvider";
import type { CompareParam, Sampler } from "@/types";

// The sweepable parameters (mirrors the backend whitelist in routers/compare.py).
const WHITELIST: CompareParam[] = ["steps", "guidance_scale", "sampler", "seed"];
// Mirrors MAX_CELLS in routers/compare.py — the grid is capped to this many images.
const MAX_CELLS = 64;

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

  const activeAxes = axes.filter((a) => a.values.length > 0);
  const cellCount = activeAxes.reduce((n, a) => n * a.values.length, 1);
  const overCap = activeAxes.length > 0 && cellCount > MAX_CELLS;
  const canRun = !!slug && !!prompt.trim() && activeAxes.length > 0 && !overCap && !running;

  const usedElsewhere = (index: number, param: CompareParam) =>
    axes.some((a, j) => j !== index && a.param === param);
  const optionsFor = (index: number) =>
    WHITELIST.filter((p) => p === axes[index].param || !usedElsewhere(index, p));
  const freeParam = () => WHITELIST.find((p) => !axes.some((a) => a.param === p));

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
      prompt,
      negative_prompt: negative.trim() === "" ? null : negative,
      width,
      height,
      steps,
      guidance_scale: guidance,
      seed: seed.trim() === "" ? null : Number(seed),
      sampler,
      axes: activeAxes,
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
          <Stack spacing={3}>
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
                  <Box
                    sx={{
                      display: "grid",
                      gap: 2,
                      gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)" },
                    }}
                  >
                    <TextField
                      select
                      size="small"
                      label={t("compare.base.sampler")}
                      value={samplers.some((s) => s.id === sampler) ? sampler : ""}
                      onChange={(e) => setSampler(e.target.value)}
                    >
                      {samplers.map((s) => (
                        <MenuItem key={s.id} value={s.id}>
                          {s.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      type="number"
                      size="small"
                      label={t("compare.base.steps")}
                      value={steps}
                      onChange={(e) =>
                        setSteps(Math.max(1, Math.min(150, Number(e.target.value) || 1)))
                      }
                    />
                    <TextField
                      type="number"
                      size="small"
                      label={t("compare.base.guidance")}
                      value={guidance}
                      onChange={(e) =>
                        setGuidance(Math.max(0, Math.min(30, Number(e.target.value) || 0)))
                      }
                    />
                    <TextField
                      type="number"
                      size="small"
                      label={t("compare.base.width")}
                      value={width}
                      onChange={(e) =>
                        setWidth(Math.max(128, Math.min(2048, Number(e.target.value) || 128)))
                      }
                    />
                    <TextField
                      type="number"
                      size="small"
                      label={t("compare.base.height")}
                      value={height}
                      onChange={(e) =>
                        setHeight(Math.max(128, Math.min(2048, Number(e.target.value) || 128)))
                      }
                    />
                    <TextField
                      size="small"
                      label={t("compare.base.seed")}
                      placeholder={t("generate.seedPlaceholder")}
                      value={seed}
                      onChange={(e) => setSeed(e.target.value)}
                    />
                  </Box>
                </Box>
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

            <Stack direction="row" spacing={1}>
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
