"use client";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ClearIcon from "@mui/icons-material/Clear";
import DownloadIcon from "@mui/icons-material/Download";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import UploadIcon from "@mui/icons-material/Upload";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState } from "react";

import { SectionHeading } from "@/components/atoms/SectionHeading";
import { InfoTip } from "@/components/molecules/InfoTip";
import { PromptSnippets } from "@/components/organisms/PromptSnippets";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { upscaleStatsView } from "@/upscale/stats";
import { useUpscale } from "@/upscale/UpscaleProvider";
import { useDownloads } from "@/activity/DownloadProvider";
import type {
  GalleryImage,
  PromptSnippet,
  ReframeStrategy,
  UpscaleProgress,
  UpscalerEngine,
} from "@/types";

interface UpscalePanelProps {
  reloadToken: number;
  initialImageId?: string | null;
}

const RATIOS = ["original", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "21:9"];
const REFRAME: ReframeStrategy[] = ["cover", "contain", "edge", "outpaint"];

export const UpscalePanel = ({ reloadToken, initialImageId }: UpscalePanelProps) => {
  const t = useTranslations();
  // The upscale job AND the form (engine/source/prompt/tiling) live in a
  // persistent provider so they survive navigation and the off-route overlay can
  // read the same progress.
  const upscale = useUpscale();
  const {
    running,
    progress,
    resultId,
    error: jobError,
    engineSlug,
    source,
    prompt,
    outpaintPrompt,
    outpaintEngine,
    tile,
    targetRatio,
    reframe,
    setEngineSlug,
    setSource,
    setPrompt,
    setOutpaintPrompt,
    setOutpaintEngine,
    setTile,
    setTargetRatio,
    setReframe,
  } = upscale;

  const downloads = useDownloads();
  const [engines, setEngines] = useState<UpscalerEngine[]>([]);
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadEngines = useCallback(() => {
    api.getUpscalers().then(setEngines).catch(() => setEngines([]));
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

  // Default to the first engine once loaded.
  useEffect(() => {
    if (engineSlug === "" && engines.length > 0) setEngineSlug(engines[0].slug);
  }, [engines, engineSlug]);

  // Default the outpaint model to the first inpaint engine once loaded.
  useEffect(() => {
    const inpaint = engines.filter((e) => e.kind === "inpaint");
    if (outpaintEngine === "" && inpaint.length > 0) setOutpaintEngine(inpaint[0].slug);
  }, [engines, outpaintEngine, setOutpaintEngine]);

  // Preselect a gallery image passed via the deep-link (?image=<id>).
  useEffect(() => {
    if (initialImageId) {
      setSource({ kind: "gallery", imageId: initialImageId, preview: api.imageFileUrl(initialImageId) });
    }
  }, [initialImageId]);

  // Inpaint engines aren't selectable upscalers — they populate the outpaint-model
  // dropdown instead of the upscaler card list.
  const selectableEngines = engines.filter((e) => e.kind !== "inpaint");
  const inpaintEngines = engines.filter((e) => e.kind === "inpaint");
  const engine = selectableEngines.find((e) => e.slug === engineSlug) ?? null;
  // The chosen outpaint model (falls back to the first available inpaint engine).
  const inpaintEngine =
    inpaintEngines.find((e) => e.slug === outpaintEngine) ?? inpaintEngines[0] ?? null;
  // Engine downloads share the app-level tracker (survive navigation + feed the
  // off-route bubble). Read this engine's progress for the inline bar.
  const engineDl = engine ? downloads.progress[engine.slug] : undefined;
  const downloadPercent =
    engineDl && engineDl.status === "downloading" ? engineDl.percent : null;

  const outpaint = targetRatio !== "original" && reframe === "outpaint";
  const inpaintDl = inpaintEngine ? downloads.progress[inpaintEngine.slug] : undefined;
  const needInpaintDownload = outpaint && !!inpaintEngine && !inpaintEngine.downloaded;

  const startEngineDownload = async (eng: UpscalerEngine) => {
    setError(null);
    try {
      await api.downloadUpscaler(eng.slug);
      downloads.track(eng.slug, {
        title: eng.name,
        route: "/upscale",
        fetch: () => api.getUpscalerProgress(eng.slug),
        retry: () => api.downloadUpscaler(eng.slug),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownload = () => {
    if (engine) startEngineDownload(engine);
  };

  // Refresh the engine list once any engine (upscaler or inpaint) download finishes
  // (so `downloaded` flips), and surface a download error.
  useEffect(() => {
    if (engineDl?.status === "done" || inpaintDl?.status === "done") reloadEngines();
    if (engineDl?.status === "error") setError(engineDl.error ?? t("upscale.error"));
  }, [engineDl?.status, engineDl?.error, inpaintDl?.status, reloadEngines, t]);

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSource({ kind: "upload", dataUrl: reader.result as string });
    reader.readAsDataURL(file);
  };

  const handleRun = () => {
    if (!engine || !source) return;
    setError(null);
    upscale.start({
      engine: engine.slug,
      image_id: source.kind === "gallery" ? source.imageId : null,
      image_data: source.kind === "upload" ? source.dataUrl : null,
      prompt,
      outpaint_prompt: outpaintPrompt,
      tile,
      target_ratio: targetRatio,
      reframe,
      outpaint_engine: inpaintEngine?.slug ?? null,
    });
  };

  const sourcePreview =
    source?.kind === "gallery" ? source.preview : source?.kind === "upload" ? source.dataUrl : null;

  const handleClear = () => {
    setSource(null);
    setPrompt("");
    setOutpaintPrompt("");
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
          {/* Engine picker */}
          <Box>
            <SectionHeading level={3} sx={{ mb: 1.5 }}>
              {t("upscale.engine.title")}
            </SectionHeading>
            <Stack spacing={1.5}>
              {selectableEngines.map((e) => (
                <Paper
                  key={e.slug}
                  variant="outlined"
                  onClick={() => setEngineSlug(e.slug)}
                  sx={{
                    p: 1.5,
                    cursor: "pointer",
                    borderColor: e.slug === engineSlug ? "primary.main" : "divider",
                    borderWidth: e.slug === engineSlug ? 2 : 1,
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography variant="subtitle1" fontWeight="medium">{e.name}</Typography>
                    <Chip label={`${e.scale}×`} size="small" variant="outlined" />
                    <Chip label={`≈ ${e.approx_size_gb} GB`} size="small" variant="outlined" />
                    {e.downloaded && (
                      <Chip
                        icon={<CheckCircleIcon />}
                        label={t("upscale.engine.downloaded")}
                        color="success"
                        variant="outlined"
                        size="small"
                      />
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {e.description}
                  </Typography>
                </Paper>
              ))}
            </Stack>

            {engine && !engine.downloaded && (
              <Box sx={{ mt: 1.5 }}>
                {downloadPercent === null ? (
                  <Button
                    variant="contained"
                    startIcon={<DownloadIcon />}
                    onClick={handleDownload}
                  >
                    {t("upscale.engine.download")}
                  </Button>
                ) : (
                  <Box>
                    <LinearProgress variant="determinate" value={downloadPercent} />
                    <Typography variant="caption" color="text.secondary">
                      {t("upscale.engine.downloading")} {downloadPercent}%
                    </Typography>
                  </Box>
                )}
              </Box>
            )}
          </Box>

          {/* Source picker */}
          <Box>
            <SectionHeading level={3} sx={{ mb: 1.5 }}>
              {t("upscale.source.title")}
            </SectionHeading>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
              <Button variant="outlined" onClick={() => setPickerOpen(true)}>
                {t("upscale.source.fromGallery")}
              </Button>
              <Button component="label" variant="outlined" startIcon={<UploadIcon />}>
                {t("upscale.source.upload")}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => onUpload(e.target.files?.[0])}
                />
              </Button>
            </Stack>
            {sourcePreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <Box
                component="img"
                src={sourcePreview}
                alt={t("upscale.source.title")}
                sx={{ maxWidth: "100%", maxHeight: 220, borderRadius: 1, display: "block" }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t("upscale.source.none")}
              </Typography>
            )}
          </Box>

          {/* Target format / reframe */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
              <Typography variant="subtitle2">{t("upscale.format.title")}</Typography>
              <InfoTip text={t("upscale.format.help")} />
            </Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                select
                size="small"
                label={t("upscale.format.ratio")}
                value={targetRatio}
                onChange={(e) => setTargetRatio(e.target.value)}
                sx={{ minWidth: { xs: "100%", sm: 160 } }}
              >
                {RATIOS.map((r) => (
                  <MenuItem key={r} value={r}>
                    {r === "original" ? t("upscale.format.original") : r}
                  </MenuItem>
                ))}
              </TextField>
              {targetRatio !== "original" && (
                <TextField
                  select
                  size="small"
                  label={t("upscale.format.strategy")}
                  value={reframe}
                  onChange={(e) => setReframe(e.target.value as ReframeStrategy)}
                  helperText={t(`upscale.reframe.${reframe}Help`)}
                  sx={{ minWidth: { xs: "100%", sm: 200 } }}
                >
                  {REFRAME.map((s) => (
                    <MenuItem key={s} value={s}>
                      {t(`upscale.reframe.${s}`)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Stack>

            {outpaint && inpaintEngines.length > 0 && (
              <TextField
                select
                size="small"
                label={t("upscale.outpaint.model")}
                value={inpaintEngine?.slug ?? ""}
                onChange={(e) => setOutpaintEngine(e.target.value)}
                helperText={t("upscale.outpaint.modelHelp")}
                sx={{ mt: 1.5, minWidth: { xs: "100%", sm: 260 } }}
              >
                {inpaintEngines.map((e) => (
                  <MenuItem key={e.slug} value={e.slug}>
                    {e.name}
                    {!e.downloaded ? ` — ${t("upscale.outpaint.notInstalled")}` : ""}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {needInpaintDownload && inpaintEngine && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  {t("upscale.outpaint.needsModel", { size: inpaintEngine.approx_size_gb })}
                </Typography>
                {inpaintDl?.status === "downloading" ? (
                  <Box>
                    <LinearProgress variant="determinate" value={inpaintDl.percent} />
                    <Typography variant="caption" color="text.secondary">
                      {t("upscale.engine.downloading")} {inpaintDl.percent}%
                    </Typography>
                  </Box>
                ) : (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<DownloadIcon />}
                    onClick={() => startEngineDownload(inpaintEngine)}
                  >
                    {t("upscale.outpaint.download")}
                  </Button>
                )}
              </Box>
            )}
          </Box>

          {/* Upscaler prompt — guides the diffusion upscaler (SD x4) toward detail. */}
          {engine?.prompt_capable && (
            <Box>
              <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
                <PromptSnippets
                  kind="upscale"
                  snippets={snippets}
                  currentText={prompt}
                  onApply={(text) => setPrompt(prompt ? `${prompt}, ${text}` : text)}
                  onChanged={reloadSnippets}
                />
              </Box>
              <TextField
                label={t("upscale.prompt.label")}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                helperText={t("upscale.prompt.help")}
                multiline
                minRows={2}
                fullWidth
              />
            </Box>
          )}

          {/* Outpaint prompt — describes the scene generated in the new area. */}
          {outpaint && (
            <Box>
              <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
                <PromptSnippets
                  kind="upscale"
                  snippets={snippets}
                  currentText={outpaintPrompt}
                  onApply={(text) =>
                    setOutpaintPrompt(outpaintPrompt ? `${outpaintPrompt}, ${text}` : text)
                  }
                  onChanged={reloadSnippets}
                />
              </Box>
              <TextField
                label={t("upscale.outpaint.promptLabel")}
                value={outpaintPrompt}
                onChange={(e) => setOutpaintPrompt(e.target.value)}
                helperText={t("upscale.outpaint.promptHelp")}
                multiline
                minRows={2}
                fullWidth
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

          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="large"
              startIcon={<AutoAwesomeIcon />}
              onClick={handleRun}
              disabled={!engine || !engine.downloaded || !source || running || needInpaintDownload}
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
        <Paper variant="outlined" sx={{ p: 2, minHeight: 240 }}>
          <SectionHeading level={3} sx={{ mb: 1.5 }}>
            {t("upscale.result.title")}
          </SectionHeading>
          {running && <UpscaleStats progress={progress} />}
          {resultId ? (
            <Stack spacing={1.5}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <Box
                component="img"
                src={api.imageFileUrl(resultId)}
                alt={t("upscale.result.title")}
                sx={{ maxWidth: "100%", borderRadius: 1, display: "block" }}
              />
              <Button
                component={Link}
                href={api.imageFileUrl(resultId)}
                target="_blank"
                rel="noopener"
                startIcon={<OpenInNewIcon />}
                variant="outlined"
                sx={{ alignSelf: "flex-start" }}
              >
                {t("upscale.result.open")}
              </Button>
            </Stack>
          ) : (
            !running && (
              <Typography variant="body2" color="text.secondary">
                {t("upscale.result.empty")}
              </Typography>
            )
          )}
        </Paper>
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

/** Live inference stats shown in the result frame while an upscale runs. */
const UpscaleStats = ({ progress }: { progress: UpscaleProgress | null }) => {
  const t = useTranslations();
  const view = upscaleStatsView(progress, t);

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.5 }}>
        <Typography variant="body2" color="text.secondary">{view.label}</Typography>
        {progress && (
          <Typography variant="caption" color="text.secondary">
            {view.speed ? `${view.speed} · ` : ""}
            {t("upscale.stats.elapsed", { value: progress.elapsed.toFixed(1) })}
          </Typography>
        )}
      </Stack>
      {view.percent === null ? (
        <LinearProgress />
      ) : (
        <LinearProgress variant="determinate" value={view.percent} />
      )}
      {progress && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
          {progress.engine_name}
        </Typography>
      )}
    </Box>
  );
}

interface GalleryPickerProps {
  open: boolean;
  reloadToken: number;
  onClose: () => void;
  onPick: (image: GalleryImage) => void;
}

const GalleryPicker = ({ open, reloadToken, onClose, onPick }: GalleryPickerProps) => {
  const t = useTranslations();
  const [images, setImages] = useState<GalleryImage[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    api.getImages().then(setImages).catch(() => setImages([]));
  }, [open, reloadToken]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t("upscale.picker.title")}</DialogTitle>
      <DialogContent dividers>
        {images.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("upscale.picker.empty")}
          </Typography>
        ) : (
          <Box
            sx={{
              display: "grid",
              gap: 1.5,
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            }}
          >
            {images.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element
              <Box
                key={img.id}
                component="img"
                src={api.imageFileUrl(img.id)}
                alt={img.prompt}
                loading="lazy"
                onClick={() => onPick(img)}
                sx={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  objectFit: "cover",
                  borderRadius: 1,
                  cursor: "pointer",
                  "&:hover": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
                }}
              />
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
