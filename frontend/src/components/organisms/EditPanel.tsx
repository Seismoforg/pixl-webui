"use client";

import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import ClearIcon from "@mui/icons-material/Clear";
import DownloadIcon from "@mui/icons-material/Download";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { InfoTip } from "@/components/molecules/InfoTip";
import { LabeledSlider } from "@/components/molecules/LabeledSlider";
import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { EditResult } from "@/components/organisms/EditResult";
import { GalleryPicker } from "@/components/organisms/GalleryPicker";
import { SourcePicker } from "@/components/organisms/SourcePicker";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useEdit } from "@/providers/EditProvider";
import { trackUpscalerDownload, useDownloads } from "@/providers/DownloadProvider";
import type { GalleryImage, UpscalerEngine } from "@/types";

interface EditPanelProps {
  reloadToken: number;
  initialImageId?: string | null;
}

// Example instruction prompts shown as one-tap chips (the chip label is the prompt
// text itself). Localised via edit.examples.<key>.
const EXAMPLE_KEYS = ["night", "day", "paint", "enhance"] as const;

// Dim + lock the form controls while a job runs (mirrors InpaintPanel).
const formLockStyle = (locked: boolean): CSSProperties => ({
  border: 0,
  margin: 0,
  padding: 0,
  minInlineSize: 0,
  opacity: locked ? 0.6 : 1,
  pointerEvents: locked ? "none" : "auto",
});

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
    setSource,
    setEngine,
    setPrompt,
    setSteps,
    setGuidance,
    setSeed,
    setBatch,
  } = edit;

  const downloads = useDownloads();
  const [engines, setEngines] = useState<UpscalerEngine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceMeta, setSourceMeta] = useState<GalleryImage | null>(null);
  const [uploadDims, setUploadDims] = useState<{ w: number; h: number } | null>(null);
  const [enginesLoading, setEnginesLoading] = useState(true);

  const reloadEngines = useCallback(() => {
    api
      .getUpscalers()
      .then(setEngines)
      .catch(() => setEngines([]))
      .finally(() => setEnginesLoading(false));
  }, []);

  useEffect(() => {
    reloadEngines();
  }, [reloadEngines]);

  const editEngines = engines.filter((e) => e.kind === "edit");
  const selectedEngine = editEngines.find((e) => e.slug === engine) ?? editEngines[0] ?? null;

  // Default to the first downloaded edit engine (else the first listed) once loaded.
  useEffect(() => {
    if (engine !== "" || editEngines.length === 0) return;
    const target = editEngines.find((e) => e.downloaded) ?? editEngines[0];
    setEngine(target.slug);
  }, [editEngines, engine, setEngine]);

  // Preselect a gallery image passed via the deep-link (?image=<id>).
  useEffect(() => {
    if (initialImageId) {
      setSource({ kind: "gallery", imageId: initialImageId, preview: api.imageFileUrl(initialImageId) });
    }
  }, [initialImageId]);

  // Load the gallery source's metadata (size) for the readout.
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
    setPrompt("");
    setError(null);
    edit.reset();
  };

  return (
    <Box>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("edit.title")}
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

              {/* Edit model */}
              {enginesLoading && editEngines.length === 0 ? (
                <LoadingIndicator label={t("loading.engines")} minHeight={80} />
              ) : (
                editEngines.length > 0 && (
                  <TextField
                    select
                    size="small"
                    label={t("edit.model")}
                    value={selectedEngine?.slug ?? ""}
                    onChange={(e) => setEngine(e.target.value)}
                    helperText={t("edit.modelHelp")}
                    sx={{ minWidth: { xs: "100%", sm: 260 } }}
                  >
                    {editEngines.map((e) => (
                      <MenuItem key={e.slug} value={e.slug}>
                        {e.name}
                        {!e.downloaded ? ` — ${t("edit.notInstalled")}` : ""}
                      </MenuItem>
                    ))}
                  </TextField>
                )
              )}

              {needDownload && selectedEngine && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    {t("edit.needsModel", { size: selectedEngine.approx_size_gb })}
                  </Typography>
                  {engineDl?.status === "downloading" ? (
                    <Box>
                      <LinearProgress variant="determinate" value={engineDl.percent} />
                      <Typography variant="caption" color="text.secondary">
                        {t("edit.downloading")} {engineDl.percent}%
                      </Typography>
                    </Box>
                  ) : (
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<DownloadIcon />}
                      onClick={() => startEngineDownload(selectedEngine)}
                    >
                      {t("edit.download")}
                    </Button>
                  )}
                </Box>
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
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, mb: 0.5 }}>
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

              {/* Generation parameters */}
              <Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                  <Typography variant="subtitle2">{t("edit.params.title")}</Typography>
                  <InfoTip text={t("edit.params.help")} />
                </Box>
                <Stack spacing={1.5}>
                  <LabeledSlider
                    label={t("edit.params.steps")}
                    info={t("edit.params.stepsHelp")}
                    value={steps}
                    min={1}
                    max={150}
                    onChange={setSteps}
                  />
                  <LabeledSlider
                    label={t("edit.params.guidance")}
                    info={t("edit.params.guidanceHelp")}
                    value={guidance}
                    min={0}
                    max={10}
                    step={0.5}
                    onChange={setGuidance}
                  />
                  <LabeledSlider
                    label={t("edit.params.batch")}
                    info={t("edit.params.batchHelp")}
                    value={batch}
                    min={1}
                    max={8}
                    onChange={setBatch}
                  />
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <TextField
                      size="small"
                      label={t("edit.params.seed")}
                      placeholder={t("edit.params.seedPlaceholder")}
                      type="number"
                      value={seed}
                      onChange={(e) => setSeed(e.target.value)}
                      sx={{ flexGrow: 1 }}
                    />
                    <InfoTip text={t("edit.params.seedHelp")} />
                  </Box>
                </Stack>
              </Box>
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
