"use client";

import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import BrushIcon from "@mui/icons-material/Brush";
import ClearIcon from "@mui/icons-material/Clear";
import DownloadIcon from "@mui/icons-material/Download";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { BrushControls } from "@/components/molecules/BrushControls";
import { InfoTip } from "@/components/molecules/InfoTip";
import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { GalleryPicker } from "@/components/organisms/GalleryPicker";
import { InpaintCanvas } from "@/components/organisms/InpaintCanvas";
import { InpaintResult } from "@/components/organisms/InpaintResult";
import { SnippetPromptField } from "@/components/organisms/SnippetPromptField";
import { SourcePicker } from "@/components/organisms/SourcePicker";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useInpaint } from "@/providers/InpaintProvider";
import { trackUpscalerDownload, useDownloads } from "@/providers/DownloadProvider";
import type { GalleryImage, PromptSnippet, UpscalerEngine } from "@/types";

interface InpaintPanelProps {
  reloadToken: number;
  initialImageId?: string | null;
}

// One-tap feather presets for common inpaint jobs — set the three tuning knobs to
// sensible values so the user doesn't have to reason about them (see the docs help).
const TUNING_PRESETS = [
  { key: "retouch", mask: 30, seam: 40, seed: 15, expand: 15 },
  { key: "replace", mask: 55, seam: 45, seed: 50, expand: 40 },
  { key: "background", mask: 45, seam: 55, seed: 35, expand: 40 },
] as const;

// Dim + lock the form controls while a job runs (mirrors ReframePanel).
const formLockStyle = (locked: boolean): CSSProperties => ({
  border: 0,
  margin: 0,
  padding: 0,
  minInlineSize: 0,
  opacity: locked ? 0.6 : 1,
  pointerEvents: locked ? "none" : "auto",
});

export const InpaintPanel = ({ reloadToken, initialImageId }: InpaintPanelProps) => {
  const t = useTranslations();
  const inpaint = useInpaint();
  const {
    running,
    resultId,
    error: jobError,
    source,
    maskData,
    engine,
    prompt,
    negative,
    brushSize,
    brushSoftness,
    maskFeather,
    seamFeather,
    seedBlur,
    maskExpand,
    steps,
    refineSteps,
    refine,
    guidance,
    sampler,
    seed,
    batch,
    samplers,
    setSource,
    setMaskData,
    setEngine,
    setPrompt,
    setNegative,
    setBrushSize,
    setBrushSoftness,
    setMaskFeather,
    setSeamFeather,
    setSeedBlur,
    setMaskExpand,
    setSteps,
    setRefineSteps,
    setRefine,
    setGuidance,
    setSampler,
    setSeed,
    setBatch,
  } = inpaint;

  const downloads = useDownloads();
  const [engines, setEngines] = useState<UpscalerEngine[]>([]);
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceMeta, setSourceMeta] = useState<GalleryImage | null>(null);
  const [uploadDims, setUploadDims] = useState<{ w: number; h: number } | null>(null);
  const [enginesLoading, setEnginesLoading] = useState(true);
  const [defaultEngine, setDefaultEngine] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const reloadEngines = useCallback(() => {
    api
      .getUpscalers()
      .then(setEngines)
      .catch(() => setEngines([]))
      .finally(() => setEnginesLoading(false));
  }, []);

  const reloadSnippets = useCallback(() => {
    api.getPromptSnippets().then(setSnippets).catch(() => setSnippets([]));
  }, []);

  useEffect(() => {
    reloadEngines();
    reloadSnippets();
  }, [reloadEngines, reloadSnippets]);

  const inpaintEngines = engines.filter((e) => e.kind === "inpaint");
  const selectedEngine =
    inpaintEngines.find((e) => e.slug === engine) ?? inpaintEngines[0] ?? null;
  // FLUX Fill (GGUF) is flow-matching: it ignores the sampler and wants a higher
  // guidance / more steps than SD inpaint.
  const fluxEngine = !!selectedEngine?.is_gguf;

  // Preferred default inpaint engine from Settings (reuses the outpaint default).
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setDefaultEngine(s.default_outpaint_engine))
      .catch(() => setDefaultEngine(null))
      .finally(() => setSettingsLoaded(true));
  }, []);

  useEffect(() => {
    if (engine !== "" || !settingsLoaded || inpaintEngines.length === 0) return;
    const downloaded = inpaintEngines.filter((e) => e.downloaded);
    const target =
      downloaded.find((e) => e.slug === defaultEngine) ?? downloaded[0] ?? inpaintEngines[0];
    setEngine(target.slug);
  }, [inpaintEngines, engine, defaultEngine, settingsLoaded, setEngine]);

  // Preselect a gallery image passed via the deep-link (?image=<id>).
  useEffect(() => {
    if (initialImageId) {
      setSource({ kind: "gallery", imageId: initialImageId, preview: api.imageFileUrl(initialImageId) });
    }
  }, [initialImageId]);

  // Load the gallery source's metadata (size + prompt) for the readout + auto-fill.
  useEffect(() => {
    setUploadDims(null);
    if (source?.kind === "gallery") {
      let active = true;
      api
        .getImage(source.imageId)
        .then((m) => active && setSourceMeta(m))
        .catch(() => active && setSourceMeta(null));
      return () => {
        active = false;
      };
    }
    setSourceMeta(null);
    return undefined;
  }, [source]);

  // FLUX Fill wants a higher guidance (~30) and more steps (~50) than SD inpaint.
  useEffect(() => {
    if (!fluxEngine) return;
    setGuidance(30);
    setSteps(50);
  }, [fluxEngine, setGuidance, setSteps]);

  const sourcePrompt = source?.kind === "gallery" ? sourceMeta?.prompt?.trim() || null : null;
  const engineDl = selectedEngine ? downloads.progress[selectedEngine.slug] : undefined;
  const needDownload = !!selectedEngine && !selectedEngine.downloaded;

  const startEngineDownload = async (eng: UpscalerEngine) => {
    setError(null);
    try {
      await trackUpscalerDownload(downloads.track, eng, "/inpaint");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (engineDl?.status === "done") reloadEngines();
  }, [engineDl?.status, reloadEngines]);

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSource({ kind: "upload", dataUrl: reader.result as string });
    reader.readAsDataURL(file);
  };

  const handleRun = () => {
    if (!source || !maskData) return;
    setError(null);
    inpaint.start({
      image_id: source.kind === "gallery" ? source.imageId : null,
      image_data: source.kind === "upload" ? source.dataUrl : null,
      mask_data: maskData,
      engine: selectedEngine?.slug ?? null,
      prompt,
      negative,
      mask_softness: maskFeather / 100,
      seam_softness: seamFeather / 100,
      seed_softness: seedBlur / 100,
      mask_expand: maskExpand / 100,
      steps,
      refine_steps: refineSteps,
      refine,
      guidance,
      sampler: sampler || null,
      seed: seed.trim() === "" ? null : Number(seed),
      batch,
    });
  };

  const sourcePreview =
    source?.kind === "gallery" ? source.preview : source?.kind === "upload" ? source.dataUrl : null;

  const sourceDims =
    source?.kind === "gallery"
      ? sourceMeta
        ? { w: sourceMeta.width, h: sourceMeta.height }
        : null
      : uploadDims;

  const handleClear = () => {
    setSource(null);
    setMaskData(null);
    setPrompt("");
    setNegative("");
    setError(null);
    inpaint.reset();
  };

  return (
    <Box>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("inpaint.title")}
      </SectionHeading>

      {(error ?? jobError) && (
        <Alert severity="error" sx={{ mb: 2 }}>{error ?? jobError}</Alert>
      )}

      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, alignItems: "start" }}>
        <Stack spacing={3}>
          <fieldset disabled={running} style={formLockStyle(running)}>
            <Stack spacing={3}>
              <SourcePicker
                preview={sourcePreview}
                dims={sourceDims}
                meta={source?.kind === "gallery" ? sourceMeta : null}
                onPickFromGallery={() => setPickerOpen(true)}
                onUpload={onUpload}
                onUploadDims={setUploadDims}
              />

              {/* Inpaint model */}
              {enginesLoading && inpaintEngines.length === 0 ? (
                <LoadingIndicator label={t("loading.engines")} minHeight={80} />
              ) : (
                inpaintEngines.length > 0 && (
                  <TextField
                    select
                    size="small"
                    label={t("inpaint.model")}
                    value={selectedEngine?.slug ?? ""}
                    onChange={(e) => setEngine(e.target.value)}
                    helperText={t("inpaint.modelHelp")}
                    sx={{ minWidth: { xs: "100%", sm: 260 } }}
                  >
                    {inpaintEngines.map((e) => (
                      <MenuItem key={e.slug} value={e.slug}>
                        {e.name}
                        {!e.downloaded ? ` — ${t("inpaint.notInstalled")}` : ""}
                      </MenuItem>
                    ))}
                  </TextField>
                )
              )}

              {needDownload && selectedEngine && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    {t("inpaint.needsModel", { size: selectedEngine.approx_size_gb })}
                  </Typography>
                  {engineDl?.status === "downloading" ? (
                    <Box>
                      <LinearProgress variant="determinate" value={engineDl.percent} />
                      <Typography variant="caption" color="text.secondary">
                        {t("inpaint.downloading")} {engineDl.percent}%
                      </Typography>
                    </Box>
                  ) : (
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<DownloadIcon />}
                      onClick={() => startEngineDownload(selectedEngine)}
                    >
                      {t("inpaint.download")}
                    </Button>
                  )}
                </Box>
              )}

              {/* Mask editor + brush */}
              <Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                  <Typography variant="subtitle2">{t("inpaint.mask.title")}</Typography>
                  <InfoTip text={t("inpaint.mask.help")} />
                </Box>
                <InpaintCanvas
                  preview={sourcePreview}
                  brushSize={brushSize}
                  brushSoftness={brushSoftness}
                  maskSoftness={maskFeather / 100}
                  seamSoftness={seamFeather / 100}
                  seedSoftness={seedBlur / 100}
                  disabled={running}
                  value={maskData}
                  onChange={setMaskData}
                />
                <Box sx={{ mt: 2 }}>
                  <BrushControls
                    size={brushSize}
                    softness={brushSoftness}
                    onSize={setBrushSize}
                    onSoftness={setBrushSoftness}
                  />
                </Box>
              </Box>

              {/* Feather tuning — mask gradient / composite seam / seed blur. */}
              <Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                  <Typography variant="subtitle2">{t("inpaint.tuning.title")}</Typography>
                  <InfoTip text={t("inpaint.tuning.help")} />
                </Box>
                {/* One-tap presets that set the three sliders for common jobs. */}
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  {t("inpaint.tuning.presets")}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: "wrap", gap: 1 }}>
                  {TUNING_PRESETS.map((p) => (
                    <Tooltip key={p.key} title={t(`inpaint.tuning.preset.${p.key}Help`)}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          setMaskFeather(p.mask);
                          setSeamFeather(p.seam);
                          setSeedBlur(p.seed);
                          setMaskExpand(p.expand);
                        }}
                      >
                        {t(`inpaint.tuning.preset.${p.key}`)}
                      </Button>
                    </Tooltip>
                  ))}
                </Stack>
                <Stack spacing={1.5}>
                  <LabeledSlider
                    label={t("inpaint.tuning.maskExpand")}
                    info={t("inpaint.tuning.maskExpandHelp")}
                    value={maskExpand}
                    min={0}
                    max={100}
                    onChange={setMaskExpand}
                  />
                  <LabeledSlider
                    label={t("inpaint.tuning.maskFeather")}
                    info={t("inpaint.tuning.maskFeatherHelp")}
                    value={maskFeather}
                    min={0}
                    max={100}
                    onChange={setMaskFeather}
                  />
                  <LabeledSlider
                    label={t("inpaint.tuning.seamFeather")}
                    info={t("inpaint.tuning.seamFeatherHelp")}
                    value={seamFeather}
                    min={0}
                    max={100}
                    onChange={setSeamFeather}
                  />
                  <LabeledSlider
                    label={t("inpaint.tuning.seedBlur")}
                    info={t("inpaint.tuning.seedBlurHelp")}
                    value={seedBlur}
                    min={0}
                    max={100}
                    onChange={setSeedBlur}
                  />
                </Stack>
              </Box>

              {/* Prompt + negative */}
              <Box>
                <SnippetPromptField
                  kind="outpaint"
                  snippets={snippets.filter((s) => s.kind === "outpaint")}
                  value={prompt}
                  onChange={setPrompt}
                  onAppend={(text) => setPrompt(prompt ? `${prompt}, ${text}` : text)}
                  onSnippetsChanged={reloadSnippets}
                  label={t("inpaint.promptLabel")}
                  helperText={t("inpaint.promptHelp")}
                />
                {sourcePrompt ? (
                  <Button
                    size="small"
                    startIcon={<AutoFixHighIcon />}
                    onClick={() => setPrompt(sourcePrompt)}
                    sx={{ mt: 1 }}
                  >
                    {t("inpaint.autofill")}
                  </Button>
                ) : null}
                <Box sx={{ mt: 2 }}>
                  <SnippetPromptField
                    kind="outpaint_negative"
                    snippets={snippets.filter((s) => s.kind === "outpaint_negative")}
                    value={negative}
                    onChange={setNegative}
                    onAppend={(text) => setNegative(negative ? `${negative}, ${text}` : text)}
                    onSnippetsChanged={reloadSnippets}
                    label={t("inpaint.negativeLabel")}
                    helperText={t("inpaint.negativeHelp")}
                  />
                </Box>
              </Box>

              {/* Generation parameters */}
              <Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                  <Typography variant="subtitle2">{t("inpaint.params.title")}</Typography>
                  <InfoTip text={t("inpaint.params.help")} />
                </Box>
                <Stack spacing={1.5}>
                  {!fluxEngine && (
                    <TextField
                      select
                      size="small"
                      label={t("inpaint.params.sampler")}
                      value={samplers.some((s) => s.id === sampler) ? sampler : ""}
                      onChange={(e) => setSampler(e.target.value)}
                      helperText={t("inpaint.params.samplerHelp")}
                    >
                      {samplers.map((s) => (
                        <MenuItem key={s.id} value={s.id}>
                          {s.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                  <LabeledSlider
                    label={t("inpaint.params.steps")}
                    info={t("inpaint.params.stepsHelp")}
                    value={steps}
                    min={1}
                    max={150}
                    onChange={setSteps}
                  />
                  <Box>
                    <FormControlLabel
                      control={<Switch checked={refine} onChange={(e) => setRefine(e.target.checked)} />}
                      label={
                        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                          {t("inpaint.params.refine")}
                          <InfoTip text={t("inpaint.params.refineHelp")} sx={{ fontSize: 16 }} />
                        </Box>
                      }
                    />
                  </Box>
                  {refine && (
                    <LabeledSlider
                      label={t("inpaint.params.refineSteps")}
                      info={t("inpaint.params.refineStepsHelp")}
                      value={refineSteps}
                      min={1}
                      max={150}
                      onChange={setRefineSteps}
                    />
                  )}
                  <LabeledSlider
                    label={t("inpaint.params.guidance")}
                    info={t("inpaint.params.guidanceHelp")}
                    value={guidance}
                    min={0}
                    max={30}
                    step={0.5}
                    onChange={setGuidance}
                  />
                  <LabeledSlider
                    label={t("inpaint.params.batch")}
                    info={t("inpaint.params.batchHelp")}
                    value={batch}
                    min={1}
                    max={8}
                    onChange={setBatch}
                  />
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <TextField
                      size="small"
                      label={t("inpaint.params.seed")}
                      placeholder={t("inpaint.params.seedPlaceholder")}
                      type="number"
                      value={seed}
                      onChange={(e) => setSeed(e.target.value)}
                      sx={{ flexGrow: 1 }}
                    />
                    <InfoTip text={t("inpaint.params.seedHelp")} />
                  </Box>
                </Stack>
              </Box>
            </Stack>
          </fieldset>

          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="large"
              startIcon={<BrushIcon />}
              onClick={handleRun}
              disabled={!source || !maskData || running || needDownload}
              sx={{ flexGrow: 1 }}
            >
              {running ? t("inpaint.running") : t("inpaint.run")}
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<ClearIcon />}
              onClick={handleClear}
              disabled={running || (!source && !prompt && !resultId)}
            >
              {t("inpaint.clear")}
            </Button>
          </Stack>
        </Stack>

        <InpaintResult />
      </Box>

      <GalleryPicker
        open={pickerOpen}
        reloadToken={reloadToken}
        onClose={() => setPickerOpen(false)}
        onPick={(img) => {
          setSource({ kind: "gallery", imageId: img.id, preview: api.imageFileUrl(img.id) });
          setPickerOpen(false);
        }}
      />
    </Box>
  );
};
