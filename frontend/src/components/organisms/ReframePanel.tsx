"use client";

import AspectRatioIcon from "@mui/icons-material/AspectRatio";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import ClearIcon from "@mui/icons-material/Clear";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { InfoTip } from "@/components/molecules/InfoTip";
import { GenerationParams } from "@/components/molecules/GenerationParams";
import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { EnginePicker } from "@/components/organisms/EnginePicker";
import { GalleryPicker } from "@/components/organisms/GalleryPicker";
import { ReframeResult } from "@/components/organisms/ReframeResult";
import { SnippetPromptField } from "@/components/organisms/SnippetPromptField";
import { SourcePicker } from "@/components/organisms/SourcePicker";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { formLockStyle } from "@/lib/formLock";
import { useEngineCatalog } from "@/lib/useEngineCatalog";
import { useImageSource } from "@/lib/useImageSource";
import { useReframe } from "@/providers/ReframeProvider";
import { trackUpscalerDownload, useDownloads } from "@/providers/DownloadProvider";
import type { PromptSnippet, ReframeStrategy, UpscalerEngine } from "@/types";

interface ReframePanelProps {
  reloadToken: number;
  initialImageId?: string | null;
}

// Reframing always changes the ratio, so "original" is intentionally absent.
const RATIOS = ["16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "21:9"];
const REFRAME: ReframeStrategy[] = ["cover", "contain", "edge", "outpaint"];

export const ReframePanel = ({ reloadToken, initialImageId }: ReframePanelProps) => {
  const t = useTranslations();
  // The reframe job AND the form live in a persistent provider so they survive
  // navigation and the off-route overlay can read the same progress.
  const reframe = useReframe();
  const {
    running,
    resultId,
    error: jobError,
    source,
    targetRatio,
    customWidth,
    customHeight,
    reframe: strategy,
    outpaintPrompt,
    outpaintNegative,
    outpaintEngine,
    maskFeather,
    seamFeather,
    seedBlur,
    posX,
    posY,
    scale,
    outpaintSteps,
    outpaintRefineSteps,
    outpaintRefine,
    outpaintGuidance,
    outpaintSampler,
    outpaintSeed,
    outpaintBatch,
    samplers,
    setSource,
    setTargetRatio,
    setCustomWidth,
    setCustomHeight,
    setReframe,
    setOutpaintPrompt,
    setOutpaintNegative,
    setOutpaintEngine,
    setMaskFeather,
    setSeamFeather,
    setSeedBlur,
    setPosX,
    setPosY,
    setScale,
    setOutpaintSteps,
    setOutpaintRefineSteps,
    setOutpaintRefine,
    setOutpaintGuidance,
    setOutpaintSampler,
    setOutpaintSeed,
    setOutpaintBatch,
  } = reframe;

  const downloads = useDownloads();
  const {
    engines,
    loading: enginesLoading,
    error: enginesError,
    reload: reloadEngines,
  } = useEngineCatalog();
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Preferred default outpaint engine from Settings (applied only when downloaded).
  const [defaultOutpaint, setDefaultOutpaint] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const { sourceMeta, setUploadDims, sourcePreview, sourceDims } = useImageSource(
    source,
    setSource,
    initialImageId,
  );

  const reloadSnippets = useCallback(() => {
    api
      .getPromptSnippets()
      .then(setSnippets)
      .catch(() => setSnippets([]));
  }, []);

  useEffect(() => {
    reloadSnippets();
  }, [reloadSnippets]);

  // Only inpaint engines are selectable outpaint models. Memoized so the selected
  // engine + the defaults effect are stable across unrelated re-renders.
  const inpaintEngines = useMemo(() => engines.filter((e) => e.kind === "inpaint"), [engines]);
  // The chosen outpaint model (falls back to the first available inpaint engine).
  const selectedEngine = useMemo(
    () => inpaintEngines.find((e) => e.slug === outpaintEngine) ?? inpaintEngines[0] ?? null,
    [inpaintEngines, outpaintEngine],
  );
  // Flow-matching engines (FLUX Fill GGUF/NF4, Z-Image, SD 3.x) keep their native
  // scheduler (no sampler) and their own tuned defaults — SD-tuned source params don't
  // transfer to them.
  const flowMatchOutpaint =
    !!selectedEngine &&
    (selectedEngine.is_gguf || /flux|z-image|stable-diffusion-3/i.test(selectedEngine.repo_id));

  // Apply the selected outpaint engine's tuned defaults (steps / guidance / refine
  // steps) when the engine changes — otherwise the form keeps generic values for every
  // engine (Z-Image wants 9 steps / guidance 0, FLUX Fill 28 / 30, SD 30 / 7.5).
  useEffect(() => {
    if (!selectedEngine) return;
    setOutpaintSteps(selectedEngine.defaults.steps);
    setOutpaintRefineSteps(selectedEngine.defaults.refine_steps);
    setOutpaintGuidance(selectedEngine.defaults.guidance_scale);
  }, [selectedEngine, setOutpaintSteps, setOutpaintRefineSteps, setOutpaintGuidance]);

  // Load the preferred default outpaint engine from Settings (best-effort).
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setDefaultOutpaint(s.default_outpaint_engine))
      .catch(() => setDefaultOutpaint(null))
      .finally(() => setSettingsLoaded(true));
  }, []);

  // Default the outpaint model once loaded: the Settings default when downloaded,
  // else the first downloaded inpaint engine (else the first so its download prompt
  // shows). Waits for Settings so the default wins.
  useEffect(() => {
    if (outpaintEngine !== "" || !settingsLoaded || inpaintEngines.length === 0) return;
    const downloaded = inpaintEngines.filter((e) => e.downloaded);
    const target =
      downloaded.find((e) => e.slug === defaultOutpaint) ?? downloaded[0] ?? inpaintEngines[0];
    setOutpaintEngine(target.slug);
  }, [inpaintEngines, outpaintEngine, defaultOutpaint, settingsLoaded, setOutpaintEngine]);

  // Auto-fill the outpaint generation params from a gallery source's original
  // metadata (like the prompt auto-fill), so extending an image reuses how it was
  // made. Guarded: only a sampler present in the registry and only steps/guidance
  // > 0 (a source that was itself a reframe/upscale carries sampler:"reframe" /
  // steps:0, which is skipped). Seed/batch are intentionally not adopted.
  useEffect(() => {
    // For a flow-matching outpaint engine the engine's own defaults take precedence
    // over the source's SD-tuned params, so skip this autofill then.
    if (!sourceMeta || samplers.length === 0 || flowMatchOutpaint) return;
    if (sourceMeta.steps > 0) setOutpaintSteps(sourceMeta.steps);
    if (sourceMeta.guidance_scale > 0) setOutpaintGuidance(sourceMeta.guidance_scale);
    if (samplers.some((s) => s.id === sourceMeta.sampler)) setOutpaintSampler(sourceMeta.sampler);
  }, [
    sourceMeta,
    samplers,
    flowMatchOutpaint,
    setOutpaintSteps,
    setOutpaintGuidance,
    setOutpaintSampler,
  ]);

  const outpaint = strategy === "outpaint";
  // Auto-fill source: a gallery image carries its original generation prompt in
  // metadata (uploads carry none).
  const sourcePrompt = source?.kind === "gallery" ? sourceMeta?.prompt?.trim() || null : null;
  const inpaintDl = selectedEngine ? downloads.progress[selectedEngine.slug] : undefined;
  const needInpaintDownload = outpaint && !!selectedEngine && !selectedEngine.downloaded;

  const startEngineDownload = async (eng: UpscalerEngine) => {
    setError(null);
    try {
      await trackUpscalerDownload(downloads.track, eng, "/reframe");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Refresh the engine list once an inpaint download finishes (so `downloaded`
  // flips), and surface a download error.
  useEffect(() => {
    if (inpaintDl?.status === "done") reloadEngines();
    if (inpaintDl?.status === "error") setError(inpaintDl.error ?? t("reframe.error"));
  }, [inpaintDl?.status, inpaintDl?.error, reloadEngines, t]);

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSource({ kind: "upload", dataUrl: reader.result as string });
    reader.readAsDataURL(file);
  };

  const isCustom = targetRatio === "custom";
  // Both dimensions must be within the backend's 64–4096 bounds to run.
  const inRange = (n: number) => Number.isFinite(n) && n >= 64 && n <= 4096;
  const customValid = !isCustom || (inRange(customWidth) && inRange(customHeight));

  const handleRun = () => {
    if (!source || !customValid) return;
    setError(null);
    reframe.start({
      image_id: source.kind === "gallery" ? source.imageId : null,
      image_data: source.kind === "upload" ? source.dataUrl : null,
      // Custom: send "WxH" as the ratio (derives the aspect) + the exact pixel size.
      target_ratio: isCustom ? `${customWidth}x${customHeight}` : targetRatio,
      target_width: isCustom ? customWidth : null,
      target_height: isCustom ? customHeight : null,
      reframe: strategy,
      outpaint_prompt: outpaintPrompt,
      outpaint_negative: outpaintNegative,
      outpaint_engine: selectedEngine?.slug ?? null,
      mask_softness: maskFeather / 100,
      seam_softness: seamFeather / 100,
      seed_softness: seedBlur / 100,
      pos_x: posX / 100,
      pos_y: posY / 100,
      // cover has no surrounding area to shrink into — always send 1.0 there.
      scale: strategy === "cover" ? 1 : scale / 100,
      outpaint_steps: outpaintSteps,
      outpaint_refine_steps: outpaintRefineSteps,
      outpaint_refine: outpaintRefine,
      outpaint_guidance: outpaintGuidance,
      outpaint_sampler: outpaintSampler || null,
      outpaint_seed: outpaintSeed.trim() === "" ? null : Number(outpaintSeed),
      outpaint_batch: outpaintBatch,
    });
  };

  const handleClear = () => {
    setSource(null);
    setOutpaintPrompt("");
    setOutpaintNegative("");
    setError(null);
    reframe.reset();
  };

  const displayError = error ?? jobError ?? (enginesError ? t("reframe.engineLoadError") : null);
  const inpaintDownloadPercent =
    inpaintDl && inpaintDl.status === "downloading" ? inpaintDl.percent : null;

  return (
    <Box>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("reframe.title")}
      </SectionHeading>

      {displayError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {displayError}
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          alignItems: "start",
        }}
      >
        <Stack spacing={3}>
          {/* Lock the controls while a job runs (see formLockStyle). */}
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

              {/* Target format / reframe */}
              <Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                  <SectionHeading level={3} variant="subtitle2">
                    {t("reframe.format.title")}
                  </SectionHeading>
                  <InfoTip text={t("reframe.format.help")} />
                </Box>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  <TextField
                    select
                    size="small"
                    label={t("reframe.format.ratio")}
                    value={targetRatio}
                    onChange={(e) => setTargetRatio(e.target.value)}
                    sx={{ minWidth: { xs: "100%", sm: 160 } }}
                  >
                    {RATIOS.map((r) => (
                      <MenuItem key={r} value={r}>
                        {r}
                      </MenuItem>
                    ))}
                    <MenuItem value="custom">{t("reframe.format.custom")}</MenuItem>
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label={t("reframe.format.strategy")}
                    value={strategy}
                    onChange={(e) => setReframe(e.target.value as ReframeStrategy)}
                    helperText={t(`reframe.strategy.${strategy}Help`)}
                    sx={{ minWidth: { xs: "100%", sm: 200 } }}
                  >
                    {REFRAME.map((s) => (
                      <MenuItem key={s} value={s}>
                        {t(`reframe.strategy.${s}`)}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>

                {/* Custom exact output resolution (px). The result is resized to exactly
                this size after the strategy sets the aspect (may upscale). */}
                {isCustom && (
                  <Stack direction="row" spacing={1.5} sx={{ mt: 1.5, alignItems: "flex-start" }}>
                    <TextField
                      size="small"
                      type="number"
                      label={t("reframe.format.width")}
                      value={customWidth}
                      onChange={(e) => setCustomWidth(Number(e.target.value))}
                      error={!inRange(customWidth)}
                      helperText={
                        !inRange(customWidth) ? t("reframe.format.rangeError") : undefined
                      }
                      inputProps={{ min: 64, max: 4096 }}
                      sx={{ maxWidth: 130 }}
                    />
                    <Typography sx={{ mt: 1 }} aria-hidden>
                      ×
                    </Typography>
                    <TextField
                      size="small"
                      type="number"
                      label={t("reframe.format.height")}
                      value={customHeight}
                      onChange={(e) => setCustomHeight(Number(e.target.value))}
                      error={!inRange(customHeight)}
                      inputProps={{ min: 64, max: 4096 }}
                      helperText={
                        !inRange(customHeight)
                          ? t("reframe.format.rangeError")
                          : t("reframe.format.customHelp")
                      }
                      sx={{ maxWidth: 130 }}
                    />
                  </Stack>
                )}

                {outpaint && (enginesLoading || inpaintEngines.length > 0) && (
                  <Box sx={{ mt: 1.5 }}>
                    <EnginePicker
                      engine={selectedEngine}
                      engines={inpaintEngines}
                      loading={enginesLoading}
                      downloadPercent={inpaintDownloadPercent}
                      onSelect={setOutpaintEngine}
                      onDownload={() => selectedEngine && startEngineDownload(selectedEngine)}
                      showHeading={false}
                      label={t("reframe.outpaint.model")}
                      notInstalledLabel={t("reframe.outpaint.notInstalled")}
                      helperText={t("reframe.outpaint.modelHelp")}
                      showDetails={false}
                      needsModelText={
                        selectedEngine
                          ? t("reframe.outpaint.needsModel", {
                              size: selectedEngine.approx_size_gb,
                            })
                          : undefined
                      }
                      downloadLabel={t("reframe.outpaint.download")}
                      downloadingLabel={t("reframe.outpaint.downloading")}
                      downloadButtonSize="small"
                      loadingMinHeight={80}
                      fullWidth={false}
                      fieldSize="small"
                      fieldSx={{ minWidth: { xs: "100%", sm: 260 } }}
                    />
                  </Box>
                )}
              </Box>

              {/* Source position — where the image sits in the extended frame, or (for
              cover) which part of the crop is kept. */}
              <Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                  <SectionHeading level={3} variant="subtitle2">
                    {t("reframe.position.title")}
                  </SectionHeading>
                  <InfoTip text={t("reframe.position.help")} />
                </Box>
                <Stack spacing={1.5}>
                  {/* Scale shrinks the source within the frame so it can be positioned;
                  cover has no surrounding area, so it's hidden there. */}
                  {strategy !== "cover" && (
                    <LabeledSlider
                      label={t("reframe.position.scale")}
                      info={t("reframe.position.scaleHelp")}
                      value={scale}
                      min={20}
                      max={100}
                      onChange={setScale}
                    />
                  )}
                  <LabeledSlider
                    label={t("reframe.position.horizontal")}
                    value={posX}
                    min={0}
                    max={100}
                    onChange={setPosX}
                  />
                  <LabeledSlider
                    label={t("reframe.position.vertical")}
                    value={posY}
                    min={0}
                    max={100}
                    onChange={setPosY}
                  />
                </Stack>
              </Box>

              {/* Seam-blend tuning — mask gradient / composite seam / seed blur. */}
              {outpaint && (
                <Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                    <SectionHeading level={3} variant="subtitle2">
                      {t("reframe.outpaint.tuning")}
                    </SectionHeading>
                    <InfoTip text={t("reframe.outpaint.tuningHelp")} />
                  </Box>
                  <Stack spacing={1.5}>
                    <LabeledSlider
                      label={t("reframe.outpaint.maskFeather")}
                      info={t("reframe.outpaint.maskFeatherHelp")}
                      value={maskFeather}
                      min={0}
                      max={100}
                      onChange={setMaskFeather}
                    />
                    <LabeledSlider
                      label={t("reframe.outpaint.seamFeather")}
                      info={t("reframe.outpaint.seamFeatherHelp")}
                      value={seamFeather}
                      min={0}
                      max={100}
                      onChange={setSeamFeather}
                    />
                    <LabeledSlider
                      label={t("reframe.outpaint.seedBlur")}
                      info={t("reframe.outpaint.seedBlurHelp")}
                      value={seedBlur}
                      min={0}
                      max={100}
                      onChange={setSeedBlur}
                    />
                  </Stack>
                </Box>
              )}

              {/* Outpaint prompt — describes the scene generated in the new area. */}
              {outpaint && (
                <Box>
                  <SnippetPromptField
                    kind="outpaint"
                    snippets={snippets.filter((s) => s.kind === "outpaint")}
                    value={outpaintPrompt}
                    onChange={setOutpaintPrompt}
                    onAppend={(text) =>
                      setOutpaintPrompt(outpaintPrompt ? `${outpaintPrompt}, ${text}` : text)
                    }
                    onSnippetsChanged={reloadSnippets}
                    label={t("reframe.outpaint.promptLabel")}
                    helperText={t("reframe.outpaint.promptHelp")}
                  />
                  {sourcePrompt ? (
                    <Button
                      size="small"
                      startIcon={<AutoFixHighIcon />}
                      onClick={() => setOutpaintPrompt(sourcePrompt)}
                      sx={{ mt: 1 }}
                    >
                      {t("reframe.outpaint.autofill")}
                    </Button>
                  ) : source?.kind === "upload" ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ mt: 1 }}
                    >
                      {t("reframe.outpaint.autofillHint")}
                    </Typography>
                  ) : null}

                  <Box sx={{ mt: 2 }}>
                    <SnippetPromptField
                      kind="outpaint_negative"
                      snippets={snippets.filter((s) => s.kind === "outpaint_negative")}
                      value={outpaintNegative}
                      onChange={setOutpaintNegative}
                      onAppend={(text) =>
                        setOutpaintNegative(
                          outpaintNegative ? `${outpaintNegative}, ${text}` : text,
                        )
                      }
                      onSnippetsChanged={reloadSnippets}
                      label={t("reframe.outpaint.negativeLabel")}
                      helperText={t("reframe.outpaint.negativeHelp")}
                    />
                  </Box>
                </Box>
              )}

              {/* Generation parameters — sampler / steps / guidance / seed / batch for
              the AI outpaint pass (the PIL strategies ignore them). */}
              {outpaint && (
                <GenerationParams
                  keyPrefix="reframe.params"
                  steps={outpaintSteps}
                  onSteps={setOutpaintSteps}
                  guidance={outpaintGuidance}
                  onGuidance={setOutpaintGuidance}
                  batch={outpaintBatch}
                  onBatch={setOutpaintBatch}
                  seed={outpaintSeed}
                  onSeed={setOutpaintSeed}
                  sampler={
                    flowMatchOutpaint
                      ? undefined
                      : { list: samplers, value: outpaintSampler, onChange: setOutpaintSampler }
                  }
                  refine={{
                    checked: outpaintRefine,
                    onChange: setOutpaintRefine,
                    steps: outpaintRefineSteps,
                    onSteps: setOutpaintRefineSteps,
                  }}
                />
              )}
            </Stack>
          </fieldset>

          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="large"
              startIcon={<AspectRatioIcon />}
              onClick={handleRun}
              disabled={!source || running || needInpaintDownload || !customValid}
              sx={{ flexGrow: 1 }}
            >
              {running ? t("reframe.running") : t("reframe.run")}
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<ClearIcon />}
              onClick={handleClear}
              disabled={running || (!source && !outpaintPrompt && !resultId)}
            >
              {t("reframe.clear")}
            </Button>
          </Stack>
        </Stack>

        {/* Result */}
        <ReframeResult preview={sourcePreview} dims={sourceDims} />
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
