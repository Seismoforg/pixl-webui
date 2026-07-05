"use client";

import AspectRatioIcon from "@mui/icons-material/AspectRatio";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import ClearIcon from "@mui/icons-material/Clear";
import DownloadIcon from "@mui/icons-material/Download";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { InfoTip } from "@/components/molecules/InfoTip";
import { LoadingIndicator } from "@/components/molecules/LoadingIndicator";
import { ReframePreview } from "@/components/molecules/ReframePreview";
import { GalleryPicker } from "@/components/organisms/GalleryPicker";
import { ReframeResult } from "@/components/organisms/ReframeResult";
import { SnippetPromptField } from "@/components/organisms/SnippetPromptField";
import { SourcePicker } from "@/components/organisms/SourcePicker";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useReframe } from "@/providers/ReframeProvider";
import { trackUpscalerDownload, useDownloads } from "@/providers/DownloadProvider";
import type {
  GalleryImage,
  PromptSnippet,
  ReframeStrategy,
  UpscalerEngine,
} from "@/types";

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
    reframe: strategy,
    outpaintPrompt,
    outpaintEngine,
    setSource,
    setTargetRatio,
    setReframe,
    setOutpaintPrompt,
    setOutpaintEngine,
  } = reframe;

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

  // Only inpaint engines are selectable outpaint models.
  const inpaintEngines = engines.filter((e) => e.kind === "inpaint");
  // The chosen outpaint model (falls back to the first available inpaint engine).
  const inpaintEngine =
    inpaintEngines.find((e) => e.slug === outpaintEngine) ?? inpaintEngines[0] ?? null;

  // Default the outpaint model to the first inpaint engine once loaded.
  useEffect(() => {
    if (outpaintEngine === "" && inpaintEngines.length > 0) setOutpaintEngine(inpaintEngines[0].slug);
  }, [inpaintEngines, outpaintEngine, setOutpaintEngine]);

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

  const outpaint = strategy === "outpaint";
  // Auto-fill source: a gallery image carries its original generation prompt in
  // metadata (uploads carry none).
  const sourcePrompt = source?.kind === "gallery" ? sourceMeta?.prompt?.trim() || null : null;
  const inpaintDl = inpaintEngine ? downloads.progress[inpaintEngine.slug] : undefined;
  const needInpaintDownload = outpaint && !!inpaintEngine && !inpaintEngine.downloaded;

  const startEngineDownload = async (eng: UpscalerEngine) => {
    setError(null);
    try {
      await trackUpscalerDownload(downloads.track, eng, "/reframe");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Refresh the engine list once an inpaint download finishes (so `downloaded` flips).
  useEffect(() => {
    if (inpaintDl?.status === "done") reloadEngines();
  }, [inpaintDl?.status, reloadEngines]);

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSource({ kind: "upload", dataUrl: reader.result as string });
    reader.readAsDataURL(file);
  };

  const handleRun = () => {
    if (!source) return;
    setError(null);
    reframe.start({
      image_id: source.kind === "gallery" ? source.imageId : null,
      image_data: source.kind === "upload" ? source.dataUrl : null,
      target_ratio: targetRatio,
      reframe: strategy,
      outpaint_prompt: outpaintPrompt,
      outpaint_engine: inpaintEngine?.slug ?? null,
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
    setOutpaintPrompt("");
    setError(null);
    reframe.reset();
  };

  return (
    <Box>
      <SectionHeading level={2} sx={{ mb: 2 }}>
        {t("reframe.title")}
      </SectionHeading>

      {(error ?? jobError) && (
        <Alert severity="error" sx={{ mb: 2 }}>{error ?? jobError}</Alert>
      )}

      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, alignItems: "start" }}>
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
              <Typography variant="subtitle2">{t("reframe.format.title")}</Typography>
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

            {outpaint && enginesLoading && inpaintEngines.length === 0 && (
              <LoadingIndicator label={t("loading.engines")} minHeight={80} />
            )}

            {outpaint && inpaintEngines.length > 0 && (
              <TextField
                select
                size="small"
                label={t("reframe.outpaint.model")}
                value={inpaintEngine?.slug ?? ""}
                onChange={(e) => setOutpaintEngine(e.target.value)}
                helperText={t("reframe.outpaint.modelHelp")}
                sx={{ mt: 1.5, minWidth: { xs: "100%", sm: 260 } }}
              >
                {inpaintEngines.map((e) => (
                  <MenuItem key={e.slug} value={e.slug}>
                    {e.name}
                    {!e.downloaded ? ` — ${t("reframe.outpaint.notInstalled")}` : ""}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {needInpaintDownload && inpaintEngine && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  {t("reframe.outpaint.needsModel", { size: inpaintEngine.approx_size_gb })}
                </Typography>
                {inpaintDl?.status === "downloading" ? (
                  <Box>
                    <LinearProgress variant="determinate" value={inpaintDl.percent} />
                    <Typography variant="caption" color="text.secondary">
                      {t("reframe.outpaint.downloading")} {inpaintDl.percent}%
                    </Typography>
                  </Box>
                ) : (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<DownloadIcon />}
                    onClick={() => startEngineDownload(inpaintEngine)}
                  >
                    {t("reframe.outpaint.download")}
                  </Button>
                )}
              </Box>
            )}
          </Box>

          {/* Pre-generation layout preview: the target frame + the new/cropped area. */}
          <ReframePreview
            preview={sourcePreview}
            dims={sourceDims}
            targetRatio={targetRatio}
            strategy={strategy}
          />

          {/* Outpaint prompt — describes the scene generated in the new area. */}
          {outpaint && (
            <Box>
              <SnippetPromptField
                kind="upscale"
                snippets={snippets}
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
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  {t("reframe.outpaint.autofillHint")}
                </Typography>
              ) : null}
            </Box>
          )}

          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="large"
              startIcon={<AspectRatioIcon />}
              onClick={handleRun}
              disabled={!source || running || needInpaintDownload}
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
        <ReframeResult />
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
