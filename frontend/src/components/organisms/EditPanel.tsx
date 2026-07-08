"use client";

import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import ClearIcon from "@mui/icons-material/Clear";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { GenerationParams } from "@/components/molecules/GenerationParams";
import { EditResult } from "@/components/organisms/EditResult";
import { EnginePicker } from "@/components/organisms/EnginePicker";
import { GalleryPicker } from "@/components/organisms/GalleryPicker";
import { LoraPicker } from "@/components/organisms/LoraPicker";
import { SourcePicker } from "@/components/organisms/SourcePicker";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { formLockStyle } from "@/lib/formLock";
import { engineLoraFamily } from "@/lib/modelFamily";
import { useEngineCatalog } from "@/lib/useEngineCatalog";
import { useImageSource } from "@/lib/useImageSource";
import { useEdit } from "@/providers/EditProvider";
import { trackUpscalerDownload, useDownloads } from "@/providers/DownloadProvider";
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

  const downloads = useDownloads();
  const {
    engines,
    loading: enginesLoading,
    error: enginesError,
    reload: reloadEngines,
  } = useEngineCatalog();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { sourceMeta, setUploadDims, sourcePreview, sourceDims } = useImageSource(
    source,
    setSource,
    initialImageId,
  );

  // Memoized so the selected engine + the defaults effect are stable across re-renders.
  const editEngines = useMemo(() => engines.filter((e) => e.kind === "edit"), [engines]);
  const selectedEngine = useMemo(
    () => editEngines.find((e) => e.slug === engine) ?? editEngines[0] ?? null,
    [editEngines, engine],
  );

  // Default to the first downloaded edit engine (else the first listed) once loaded.
  // Intentional divergence from Reframe/Inpaint/Upscale: no `default_edit_engine`
  // Setting exists, so there is no Settings default to honour here.
  useEffect(() => {
    if (engine !== "" || editEngines.length === 0) return;
    const target = editEngines.find((e) => e.downloaded) ?? editEngines[0];
    setEngine(target.slug);
  }, [editEngines, engine, setEngine]);

  // Apply the selected edit engine's tuned defaults (steps / guidance) when it changes.
  useEffect(() => {
    if (!selectedEngine) return;
    setSteps(selectedEngine.defaults.steps);
    setGuidance(selectedEngine.defaults.guidance_scale);
  }, [selectedEngine, setSteps, setGuidance]);

  const engineDl = selectedEngine ? downloads.progress[selectedEngine.slug] : undefined;
  const needDownload = !!selectedEngine && !selectedEngine.downloaded;

  const startEngineDownload = async (eng: UpscalerEngine) => {
    setError(null);
    try {
      await trackUpscalerDownload(downloads.track, eng, "/edit");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Refresh the engine list once this engine's download finishes (so `downloaded`
  // flips), and surface a download error.
  useEffect(() => {
    if (engineDl?.status === "done") reloadEngines();
    if (engineDl?.status === "error") setError(engineDl.error ?? t("edit.error"));
  }, [engineDl?.status, engineDl?.error, reloadEngines, t]);

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSource({ kind: "upload", dataUrl: reader.result as string });
    reader.readAsDataURL(file);
  };

  const handleRun = () => {
    if (!source || !prompt.trim()) return;
    setError(null);
    edit.start({
      image_id: source.kind === "gallery" ? source.imageId : null,
      image_data: source.kind === "upload" ? source.dataUrl : null,
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
  const downloadPercent = engineDl && engineDl.status === "downloading" ? engineDl.percent : null;

  return (
    <Box>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("edit.title")}
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
            </Stack>
          </fieldset>

          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="large"
              startIcon={<AutoFixHighIcon />}
              onClick={handleRun}
              disabled={!source || !prompt.trim() || running || needDownload}
              sx={{ flexGrow: 1 }}
            >
              {running ? t("edit.running") : t("edit.run")}
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<ClearIcon />}
              onClick={handleClear}
              disabled={running || (!source && !prompt && !resultId)}
            >
              {t("edit.clear")}
            </Button>
          </Stack>
        </Stack>

        <EditResult />
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
