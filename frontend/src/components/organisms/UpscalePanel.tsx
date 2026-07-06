"use client";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ClearIcon from "@mui/icons-material/Clear";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { InfoTip } from "@/components/molecules/InfoTip";
import { EnginePicker } from "@/components/organisms/EnginePicker";
import { GalleryPicker } from "@/components/organisms/GalleryPicker";
import { SnippetPromptField } from "@/components/organisms/SnippetPromptField";
import { SourcePicker } from "@/components/organisms/SourcePicker";
import { UpscaleResult } from "@/components/organisms/UpscaleResult";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { formLockStyle } from "@/lib/formLock";
import { useUpscale } from "@/providers/UpscaleProvider";
import { trackUpscalerDownload, useDownloads } from "@/providers/DownloadProvider";
import type { GalleryImage, PromptSnippet, UpscalerEngine } from "@/types";

interface UpscalePanelProps {
  reloadToken: number;
  initialImageId?: string | null;
}

export const UpscalePanel = ({ reloadToken, initialImageId }: UpscalePanelProps) => {
  const t = useTranslations();
  // The upscale job AND the form (engine/source/prompt/tiling) live in a
  // persistent provider so they survive navigation and the off-route overlay can
  // read the same progress.
  const upscale = useUpscale();
  const {
    running,
    resultId,
    error: jobError,
    engineSlug,
    source,
    prompt,
    tile,
    sdX4Steps,
    setEngineSlug,
    setSource,
    setPrompt,
    setTile,
    setSdX4Steps,
  } = upscale;

  const downloads = useDownloads();
  const [engines, setEngines] = useState<UpscalerEngine[]>([]);
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Metadata for a gallery source (full-res size + seed/prompt/model); upload size
  // read from the loaded <img> since uploads carry no metadata.
  const [sourceMeta, setSourceMeta] = useState<GalleryImage | null>(null);
  const [uploadDims, setUploadDims] = useState<{ w: number; h: number } | null>(null);
  const [enginesLoading, setEnginesLoading] = useState(true);
  // Preferred default upscaler from Settings (applied only when downloaded).
  const [defaultUpscaler, setDefaultUpscaler] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const reloadEngines = useCallback(() => {
    api
      .getUpscalers()
      .then(setEngines)
      .catch(() => setEngines([]))
      .finally(() => setEnginesLoading(false));
  }, []);

  const reloadSnippets = useCallback(() => {
    api
      .getPromptSnippets()
      .then((all) => setSnippets(all.filter((s) => s.kind === "upscale")))
      .catch(() => setSnippets([]));
  }, []);

  useEffect(() => {
    reloadEngines();
    reloadSnippets();
  }, [reloadEngines, reloadSnippets]);

  // Load the preferred default upscaler from Settings (best-effort).
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setDefaultUpscaler(s.default_upscaler))
      .catch(() => setDefaultUpscaler(null))
      .finally(() => setSettingsLoaded(true));
  }, []);

  // Default the engine once loaded: the Settings default when downloaded, else the
  // first downloaded selectable engine (else the first selectable so the dropdown
  // isn't empty and its download prompt shows). Waits for Settings so it wins.
  useEffect(() => {
    if (engineSlug !== "" || !settingsLoaded) return;
    const selectable = engines.filter((e) => e.kind !== "inpaint");
    if (selectable.length === 0) return;
    const downloaded = selectable.filter((e) => e.downloaded);
    const target =
      downloaded.find((e) => e.slug === defaultUpscaler) ?? downloaded[0] ?? selectable[0];
    setEngineSlug(target.slug);
  }, [engines, engineSlug, defaultUpscaler, settingsLoaded, setEngineSlug]);

  // Preselect a gallery image passed via the deep-link (?image=<id>).
  useEffect(() => {
    if (initialImageId) {
      setSource({ kind: "gallery", imageId: initialImageId, preview: api.imageFileUrl(initialImageId) });
    }
  }, [initialImageId]);

  // Load the gallery source's metadata (full-res size + seed/prompt/model). Covers
  // both the picker and the deep-link path. Reset the upload size on every change.
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

  // Inpaint engines aren't selectable upscalers — they populate the outpaint-model
  // dropdown, which now lives on the Reframe page — so they're filtered out here.
  const selectableEngines = engines.filter((e) => e.kind !== "inpaint");
  const selectedEngine = selectableEngines.find((e) => e.slug === engineSlug) ?? null;
  // Engine downloads share the app-level tracker (survive navigation + feed the
  // off-route bubble). Read this engine's progress for the inline bar.
  const engineDl = selectedEngine ? downloads.progress[selectedEngine.slug] : undefined;
  const downloadPercent =
    engineDl && engineDl.status === "downloading" ? engineDl.percent : null;

  const startEngineDownload = async (eng: UpscalerEngine) => {
    setError(null);
    try {
      await trackUpscalerDownload(downloads.track, eng, "/upscale");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownload = () => {
    if (selectedEngine) startEngineDownload(selectedEngine);
  };

  // Refresh the engine list once this engine's download finishes (so `downloaded`
  // flips), and surface a download error.
  useEffect(() => {
    if (engineDl?.status === "done") reloadEngines();
    if (engineDl?.status === "error") setError(engineDl.error ?? t("upscale.error"));
  }, [engineDl?.status, engineDl?.error, reloadEngines, t]);

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSource({ kind: "upload", dataUrl: reader.result as string });
    reader.readAsDataURL(file);
  };

  const handleRun = () => {
    if (!selectedEngine || !source) return;
    setError(null);
    upscale.start({
      engine: selectedEngine.slug,
      image_id: source.kind === "gallery" ? source.imageId : null,
      image_data: source.kind === "upload" ? source.dataUrl : null,
      prompt,
      tile,
      sd_x4_steps: selectedEngine.kind === "sd_x4" ? sdX4Steps : null,
    });
  };

  const sourcePreview =
    source?.kind === "gallery" ? source.preview : source?.kind === "upload" ? source.dataUrl : null;

  // Full-res size: from metadata for a gallery image (the preview is a downscaled
  // next/image), from the loaded <img> for an upload.
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
    upscale.reset();
  };

  return (
    <Box>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("upscale.title")}
      </SectionHeading>

      {(error ?? jobError) && (
        <Alert severity="error" sx={{ mb: 2 }}>{error ?? jobError}</Alert>
      )}

      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, alignItems: "start" }}>
        <Stack spacing={3}>
          {/* Lock the controls while a job runs (see formLockStyle). */}
          <fieldset disabled={running} style={formLockStyle(running)}>
            <Stack spacing={3}>
          <EnginePicker
            engine={selectedEngine}
            engines={selectableEngines}
            loading={enginesLoading}
            downloadPercent={downloadPercent}
            onSelect={setEngineSlug}
            onDownload={handleDownload}
          />

          <SourcePicker
            preview={sourcePreview}
            dims={sourceDims}
            meta={source?.kind === "gallery" ? sourceMeta : null}
            onPickFromGallery={() => setPickerOpen(true)}
            onUpload={onUpload}
            onUploadDims={setUploadDims}
          />

          {/* Upscaler prompt — guides the diffusion upscaler (SD x4) toward detail. */}
          {selectedEngine?.prompt_capable && (
            <SnippetPromptField
              kind="upscale"
              snippets={snippets}
              value={prompt}
              onChange={setPrompt}
              onAppend={(text) => setPrompt(prompt ? `${prompt}, ${text}` : text)}
              onSnippetsChanged={reloadSnippets}
              label={t("upscale.prompt.label")}
              helperText={t("upscale.prompt.help")}
            />
          )}

          {/* SD x4 step count — per-run override of the global default. */}
          {selectedEngine?.kind === "sd_x4" && (
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                <Typography variant="subtitle2">{t("upscale.steps.label")}</Typography>
                <InfoTip text={t("upscale.steps.help")} />
              </Box>
              <TextField
                type="number"
                size="small"
                value={sdX4Steps}
                onChange={(e) => setSdX4Steps(Number(e.target.value))}
                inputProps={{ min: 1, max: 150, step: 1 }}
                sx={{ maxWidth: 140 }}
              />
            </Box>
          )}

          {/* Tiling option */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
              <Typography variant="subtitle2">{t("upscale.tiling.label")}</Typography>
              <InfoTip text={t("upscale.tiling.help")} />
            </Box>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={tile ? "auto" : "off"}
              onChange={(_, v) => v !== null && setTile(v === "auto")}
            >
              <ToggleButton value="auto">{t("upscale.tiling.auto")}</ToggleButton>
              <ToggleButton value="off">{t("upscale.tiling.off")}</ToggleButton>
            </ToggleButtonGroup>
          </Box>
            </Stack>
          </fieldset>

          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="large"
              startIcon={<AutoAwesomeIcon />}
              onClick={handleRun}
              disabled={!selectedEngine || !selectedEngine.downloaded || !source || running}
              sx={{ flexGrow: 1 }}
            >
              {running ? t("upscale.running") : t("upscale.run")}
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<ClearIcon />}
              onClick={handleClear}
              disabled={running || (!source && !prompt && !resultId)}
            >
              {t("upscale.clear")}
            </Button>
          </Stack>
        </Stack>

        {/* Result */}
        <UpscaleResult />
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
}
