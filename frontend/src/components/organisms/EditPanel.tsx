"use client";

import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { GenerationParams } from "@/components/molecules/GenerationParams";
import { EditResult } from "@/components/organisms/EditResult";
import { EnginePicker } from "@/components/organisms/EnginePicker";
import { GalleryPicker } from "@/components/organisms/GalleryPicker";
import { JobPanelShell } from "@/components/organisms/JobPanelShell";
import { LoraPicker } from "@/components/organisms/LoraPicker";
import { SourcePicker } from "@/components/organisms/SourcePicker";
import { useTranslations } from "@/i18n";
import { engineLoraFamily } from "@/lib/modelFamily";
import { useEngineSelection } from "@/lib/useEngineSelection";
import { toImageRequest, useSourcePanel } from "@/lib/useImageSource";
import { useEdit } from "@/providers/EditProvider";
import type { UpscalerEngine } from "@/types";

interface EditPanelProps {
  reloadToken: number;
  initialImageId?: string | null;
}

// Example instruction prompts shown as one-tap chips (the chip label is the prompt
// text itself). Localised via edit.examples.<key>.
const EXAMPLE_KEYS = ["night", "day", "paint", "enhance"] as const;

export const EditPanel = ({ reloadToken, initialImageId }: EditPanelProps) => {
  const t = useTranslations();
  const edit = useEdit();
  const {
    running,
    resultId,
    error: jobError,
    source,
    engine,
    prompt,
    steps,
    guidance,
    seed,
    batch,
    loras,
    setSource,
    setEngine,
    setPrompt,
    setSteps,
    setGuidance,
    setSeed,
    setBatch,
    setLoras,
  } = edit;

  const src = useSourcePanel(source, setSource, initialImageId);

  // Apply the selected edit engine's tuned defaults (steps / guidance) when it changes.
  const onEngineDefaults = useCallback(
    (eng: UpscalerEngine) => {
      setSteps(eng.defaults.steps);
      setGuidance(eng.defaults.guidance_scale);
    },
    [setSteps, setGuidance],
  );

  // Intentional divergence from Reframe/Inpaint/Upscale: no `default_edit_engine`
  // Setting exists, so there is no settingsKey to honour here.
  const {
    engines: editEngines,
    selectedEngine,
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
    filter: (e) => e.kind === "edit",
    route: "/edit",
    errorKey: "edit.error",
    onEngineDefaults,
  });

  const handleRun = () => {
    if (!source || !prompt.trim()) return;
    setError(null);
    edit.start({
      ...toImageRequest(source),
      engine: selectedEngine?.slug ?? null,
      prompt,
      steps,
      guidance,
      seed: seed.trim() === "" ? null : Number(seed),
      batch,
      loras,
    });
  };

  const handleClear = () => {
    setSource(null);
    setPrompt("");
    setError(null);
    edit.reset();
  };

  const displayError = error ?? jobError ?? (enginesError ? t("edit.engineLoadError") : null);

  return (
    <JobPanelShell
      title={t("edit.title")}
      error={displayError}
      running={running}
      runIcon={<AutoFixHighIcon />}
      runLabel={t("edit.run")}
      runningLabel={t("edit.running")}
      onRun={handleRun}
      runDisabled={!source || !prompt.trim() || running || needDownload}
      onClear={handleClear}
      clearLabel={t("edit.clear")}
      clearDisabled={running || (!source && !prompt && !resultId)}
      result={<EditResult />}
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

      {/* Edit model */}
      {(enginesLoading || editEngines.length > 0) && (
        <EnginePicker
          engine={selectedEngine}
          engines={editEngines}
          loading={enginesLoading}
          downloadPercent={downloadPercent}
          onSelect={setEngine}
          onDownload={() => selectedEngine && startEngineDownload(selectedEngine)}
          showHeading={false}
          label={t("edit.model")}
          notInstalledLabel={t("edit.notInstalled")}
          helperText={t("edit.modelHelp")}
          showDetails={false}
          needsModelText={
            selectedEngine
              ? t("edit.needsModel", { size: selectedEngine.approx_size_gb })
              : undefined
          }
          downloadLabel={t("edit.download")}
          downloadingLabel={t("edit.downloading")}
          downloadButtonSize="small"
          loadingMinHeight={80}
          fullWidth={false}
          fieldSize="small"
          fieldSx={{ minWidth: { xs: "100%", sm: 260 } }}
        />
      )}

      {/* Instruction prompt */}
      <Box>
        <TextField
          fullWidth
          multiline
          minRows={2}
          size="small"
          label={t("edit.promptLabel")}
          placeholder={t("edit.promptPlaceholder")}
          helperText={t("edit.promptHelp")}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ mt: 1, mb: 0.5 }}
        >
          {t("edit.examples.title")}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          {EXAMPLE_KEYS.map((k) => {
            const text = t(`edit.examples.${k}`);
            return (
              <Chip
                key={k}
                label={text}
                size="small"
                variant="outlined"
                icon={<AutoFixHighIcon />}
                onClick={() => setPrompt(text)}
              />
            );
          })}
        </Stack>
        {/* Honest limitation: Kontext restyles/relights well but true deblur is
            limited — Upscale stays the better tool for pure resolution. */}
        <Alert severity="info" sx={{ mt: 2 }}>
          {t("edit.qualityNote")}
        </Alert>
      </Box>

      {/* Generation parameters (no mask, no sampler — Kontext is guidance-distilled) */}
      <GenerationParams
        keyPrefix="edit.params"
        steps={steps}
        onSteps={setSteps}
        guidance={guidance}
        onGuidance={setGuidance}
        guidanceMax={10}
        batch={batch}
        onBatch={setBatch}
        seed={seed}
        onSeed={setSeed}
      />

      {/* LoRA adapters for the edit pipe (FLUX.2 klein / FLUX Kontext). */}
      {engineLoraFamily(selectedEngine) && (
        <Box>
          <SectionHeading level={3} sx={{ mb: 1 }}>
            {t("generate.sections.loras")}
          </SectionHeading>
          <LoraPicker
            family={engineLoraFamily(selectedEngine)}
            selected={loras}
            onChange={setLoras}
            onAppendPrompt={(text) => setPrompt(prompt ? `${prompt}, ${text}` : text)}
          />
        </Box>
      )}
    </JobPanelShell>
  );
};
