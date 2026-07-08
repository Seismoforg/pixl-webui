"use client";

import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import BrushIcon from "@mui/icons-material/Brush";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useCallback } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { BrushControls } from "@/components/molecules/BrushControls";
import { InfoTip } from "@/components/molecules/InfoTip";
import { GenerationParams } from "@/components/molecules/GenerationParams";
import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { EnginePicker } from "@/components/organisms/EnginePicker";
import { GalleryPicker } from "@/components/organisms/GalleryPicker";
import { InpaintCanvas } from "@/components/organisms/InpaintCanvas";
import { InpaintResult } from "@/components/organisms/InpaintResult";
import { JobPanelShell } from "@/components/organisms/JobPanelShell";
import { SnippetPromptField } from "@/components/organisms/SnippetPromptField";
import { SourcePicker } from "@/components/organisms/SourcePicker";
import { useTranslations } from "@/i18n";
import { useEngineSelection } from "@/lib/useEngineSelection";
import { toImageRequest, useSourcePanel } from "@/lib/useImageSource";
import { useSnippets } from "@/lib/useSnippets";
import { useInpaint } from "@/providers/InpaintProvider";
import type { UpscalerEngine } from "@/types";

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

  const { snippets, reloadSnippets } = useSnippets();
  const src = useSourcePanel(source, setSource, initialImageId);
  const { sourceMeta, sourcePreview } = src;

  // Apply the selected engine's tuned defaults (steps / guidance) when it changes —
  // otherwise the form keeps generic values for every engine (Z-Image wants 9 steps /
  // guidance 0, FLUX Fill 28 / 30, SD 30 / 7.5).
  const onEngineDefaults = useCallback(
    (eng: UpscalerEngine) => {
      setSteps(eng.defaults.steps);
      setGuidance(eng.defaults.guidance_scale);
    },
    [setSteps, setGuidance],
  );

  const {
    engines: inpaintEngines,
    selectedEngine,
    flowMatch: fluxEngine,
    enginesLoading,
    enginesError,
    needDownload,
    downloadPercent,
    startEngineDownload,
    error,
    setError,
  } = useEngineSelection({
    engine,
    setEngine,
    filter: (e) => e.kind === "inpaint",
    route: "/inpaint",
    errorKey: "inpaint.error",
    settingsKey: (s) => s.default_outpaint_engine,
    onEngineDefaults,
  });

  const sourcePrompt = source?.kind === "gallery" ? sourceMeta?.prompt?.trim() || null : null;

  const handleRun = () => {
    if (!source || !maskData) return;
    setError(null);
    inpaint.start({
      ...toImageRequest(source),
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

  const handleClear = () => {
    setSource(null);
    setMaskData(null);
    setPrompt("");
    setNegative("");
    setError(null);
    inpaint.reset();
  };

  const displayError = error ?? jobError ?? (enginesError ? t("inpaint.engineLoadError") : null);

  return (
    <JobPanelShell
      title={t("inpaint.title")}
      error={displayError}
      running={running}
      runIcon={<BrushIcon />}
      runLabel={t("inpaint.run")}
      runningLabel={t("inpaint.running")}
      onRun={handleRun}
      runDisabled={!source || !maskData || running || needDownload}
      onClear={handleClear}
      clearLabel={t("inpaint.clear")}
      clearDisabled={running || (!source && !prompt && !resultId)}
      result={<InpaintResult />}
      after={
        <GalleryPicker
          open={src.pickerOpen}
          reloadToken={reloadToken}
          onClose={src.closePicker}
          onPick={src.onPick}
        />
      }
    >
      <SourcePicker {...src.sourcePickerProps} />

      {/* Inpaint model */}
      {(enginesLoading || inpaintEngines.length > 0) && (
        <EnginePicker
          engine={selectedEngine}
          engines={inpaintEngines}
          loading={enginesLoading}
          downloadPercent={downloadPercent}
          onSelect={setEngine}
          onDownload={() => selectedEngine && startEngineDownload(selectedEngine)}
          showHeading={false}
          label={t("inpaint.model")}
          notInstalledLabel={t("inpaint.notInstalled")}
          helperText={t("inpaint.modelHelp")}
          showDetails={false}
          needsModelText={
            selectedEngine
              ? t("inpaint.needsModel", { size: selectedEngine.approx_size_gb })
              : undefined
          }
          downloadLabel={t("inpaint.download")}
          downloadingLabel={t("inpaint.downloading")}
          downloadButtonSize="small"
          loadingMinHeight={80}
          fullWidth={false}
          fieldSize="small"
          fieldSx={{ minWidth: { xs: "100%", sm: 260 } }}
        />
      )}

      {/* Mask editor + brush */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
          <SectionHeading level={3} variant="subtitle2">
            {t("inpaint.mask.title")}
          </SectionHeading>
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
          <SectionHeading level={3} variant="subtitle2">
            {t("inpaint.tuning.title")}
          </SectionHeading>
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
      <GenerationParams
        keyPrefix="inpaint.params"
        steps={steps}
        onSteps={setSteps}
        guidance={guidance}
        onGuidance={setGuidance}
        batch={batch}
        onBatch={setBatch}
        seed={seed}
        onSeed={setSeed}
        sampler={fluxEngine ? undefined : { list: samplers, value: sampler, onChange: setSampler }}
        refine={{
          checked: refine,
          onChange: setRefine,
          steps: refineSteps,
          onSteps: setRefineSteps,
        }}
      />
    </JobPanelShell>
  );
};
