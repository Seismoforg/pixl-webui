import { useCallback, useEffect, useMemo, useState } from "react";

import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useEngineCatalog } from "@/lib/useEngineCatalog";
import { trackUpscalerDownload, useDownloads } from "@/providers/DownloadProvider";
import type { UpscalerEngine } from "@/types";

interface Options {
  // The currently selected engine slug ("" = not yet chosen) + its setter.
  engine: string;
  setEngine: (slug: string) => void;
  // Route the download is tracked against (for the off-route activity bubble).
  route: string;
  // i18n key for a download failure (e.g. "reframe.error" / "inpaint.error").
  errorKey: string;
  // Apply the selected engine's tuned defaults when it changes (panel-specific: reframe
  // sets steps/refine/guidance, inpaint sets steps/guidance). Wrap in useCallback.
  onEngineDefaults: (engine: UpscalerEngine) => void;
}

// Inpaint-kind engine selection + download lifecycle shared by the reframe (outpaint)
// and inpaint panels: filter to inpaint engines, resolve the selected one, load the
// Settings default (default_outpaint_engine) and pick it once, apply the engine's tuned
// defaults on change, and track its download (reload the list + surface errors on done).
export const useInpaintEngineSelection = ({
  engine,
  setEngine,
  route,
  errorKey,
  onEngineDefaults,
}: Options) => {
  const t = useTranslations();
  const downloads = useDownloads();
  const {
    engines,
    loading: enginesLoading,
    error: enginesError,
    reload: reloadEngines,
  } = useEngineCatalog();
  const [error, setError] = useState<string | null>(null);
  // Preferred default engine from Settings (applied only when downloaded).
  const [defaultEngine, setDefaultEngine] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Only inpaint engines are selectable. Memoized so the selected engine + the defaults
  // effect are stable across unrelated re-renders.
  const inpaintEngines = useMemo(() => engines.filter((e) => e.kind === "inpaint"), [engines]);
  const selectedEngine = useMemo(
    () => inpaintEngines.find((e) => e.slug === engine) ?? inpaintEngines[0] ?? null,
    [inpaintEngines, engine],
  );
  // Flow-matching engines (FLUX Fill GGUF/NF4, Z-Image, SD 3.x) keep their native
  // scheduler (no sampler) and their own tuned defaults — SD-tuned params don't transfer.
  const flowMatch =
    !!selectedEngine &&
    (selectedEngine.is_gguf || /flux|z-image|stable-diffusion-3/i.test(selectedEngine.repo_id));

  // Load the preferred default engine from Settings (best-effort).
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setDefaultEngine(s.default_outpaint_engine))
      .catch(() => setDefaultEngine(null))
      .finally(() => setSettingsLoaded(true));
  }, []);

  // Default the model once loaded: the Settings default when downloaded, else the first
  // downloaded inpaint engine (else the first so its download prompt shows). Waits for
  // Settings so the default wins.
  useEffect(() => {
    if (engine !== "" || !settingsLoaded || inpaintEngines.length === 0) return;
    const downloaded = inpaintEngines.filter((e) => e.downloaded);
    const target =
      downloaded.find((e) => e.slug === defaultEngine) ?? downloaded[0] ?? inpaintEngines[0];
    setEngine(target.slug);
  }, [inpaintEngines, engine, defaultEngine, settingsLoaded, setEngine]);

  // Apply the selected engine's tuned defaults when it changes (panel-specific setters).
  useEffect(() => {
    if (!selectedEngine) return;
    onEngineDefaults(selectedEngine);
  }, [selectedEngine, onEngineDefaults]);

  const engineDl = selectedEngine ? downloads.progress[selectedEngine.slug] : undefined;
  const needDownload = !!selectedEngine && !selectedEngine.downloaded;

  const startEngineDownload = useCallback(
    async (eng: UpscalerEngine) => {
      setError(null);
      try {
        await trackUpscalerDownload(downloads.track, eng, route);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [downloads.track, route],
  );

  // Refresh the engine list once a download finishes (so `downloaded` flips), and
  // surface a download error.
  useEffect(() => {
    if (engineDl?.status === "done") reloadEngines();
    if (engineDl?.status === "error") setError(engineDl.error ?? t(errorKey));
  }, [engineDl?.status, engineDl?.error, reloadEngines, t, errorKey]);

  const downloadPercent = engineDl && engineDl.status === "downloading" ? engineDl.percent : null;

  return {
    inpaintEngines,
    selectedEngine,
    flowMatch,
    enginesLoading,
    enginesError,
    needDownload,
    downloadPercent,
    startEngineDownload,
    error,
    setError,
  };
};
