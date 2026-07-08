import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { useEngineCatalog } from "@/lib/useEngineCatalog";
import { trackUpscalerDownload, useDownloads } from "@/providers/DownloadProvider";
import type { AppSettings, UpscalerEngine } from "@/types";

interface Options {
  // The currently selected engine slug ("" = not yet chosen) + its setter.
  engine: string;
  setEngine: (slug: string) => void;
  // Which catalog engines are selectable on this panel.
  filter: (engine: UpscalerEngine) => boolean;
  // Route the download is tracked against (for the off-route activity bubble).
  route: string;
  // i18n key for a download failure (e.g. "reframe.error" / "upscale.error").
  errorKey: string;
  // Reads the panel's preferred default slug from Settings (e.g.
  // s => s.default_upscaler). Omit when no Settings default exists (edit).
  settingsKey?: (settings: AppSettings) => string | null;
  // false → no fallback selection when the slug isn't in the list (upscale keeps
  // an explicit-choice-only dropdown). Default true (first listed engine).
  fallbackToFirst?: boolean;
  // Apply the selected engine's tuned defaults when it changes (panel-specific:
  // reframe sets steps/refine/guidance, inpaint + edit set steps/guidance).
  // Wrap in useCallback.
  onEngineDefaults?: (engine: UpscalerEngine) => void;
}

// Engine selection + download lifecycle shared by the upscale/reframe/inpaint/edit
// panels: filter the catalog, resolve the selected engine, pick the default once
// (Settings default when downloaded → first downloaded → first listed), apply the
// engine's tuned defaults on change, and track its download (reload the list +
// surface errors on done).
export const useEngineSelection = ({
  engine,
  setEngine,
  filter,
  route,
  errorKey,
  settingsKey,
  fallbackToFirst = true,
  onEngineDefaults,
}: Options) => {
  const t = useTranslations();
  const downloads = useDownloads();
  const {
    engines: allEngines,
    loading: enginesLoading,
    error: enginesError,
    reload: reloadEngines,
  } = useEngineCatalog();
  const [error, setError] = useState<string | null>(null);
  // Preferred default engine from Settings (applied only when downloaded). With no
  // settingsKey there is nothing to wait for.
  const [defaultEngine, setDefaultEngine] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(!settingsKey);

  // Memoized so the selected engine + the defaults effect are stable across
  // unrelated re-renders. filter is read through a ref so an inline arrow is fine.
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const engines = useMemo(
    () => allEngines.filter((e) => filterRef.current(e)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allEngines],
  );
  const selectedEngine = useMemo(
    () => engines.find((e) => e.slug === engine) ?? (fallbackToFirst ? (engines[0] ?? null) : null),
    [engines, engine, fallbackToFirst],
  );
  // Flow-matching engines (FLUX Fill GGUF/NF4, Z-Image, SD 3.x) keep their native
  // scheduler (no sampler) and their own tuned defaults — SD-tuned params don't transfer.
  const flowMatch =
    !!selectedEngine &&
    (selectedEngine.is_gguf || /flux|z-image|stable-diffusion-3/i.test(selectedEngine.repo_id));

  // Load the preferred default engine from Settings (best-effort, once).
  const settingsKeyRef = useRef(settingsKey);
  settingsKeyRef.current = settingsKey;
  useEffect(() => {
    const read = settingsKeyRef.current;
    if (!read) return;
    api
      .getSettings()
      .then((s) => setDefaultEngine(read(s)))
      .catch(() => setDefaultEngine(null))
      .finally(() => setSettingsLoaded(true));
  }, []);

  // Default the engine once loaded: the Settings default when downloaded, else the
  // first downloaded (else the first listed so its download prompt shows). Waits for
  // Settings so the default wins.
  useEffect(() => {
    if (engine !== "" || !settingsLoaded || engines.length === 0) return;
    const downloaded = engines.filter((e) => e.downloaded);
    const target = downloaded.find((e) => e.slug === defaultEngine) ?? downloaded[0] ?? engines[0];
    setEngine(target.slug);
  }, [engines, engine, defaultEngine, settingsLoaded, setEngine]);

  // Apply the selected engine's tuned defaults when it changes (panel-specific setters).
  useEffect(() => {
    if (!selectedEngine || !onEngineDefaults) return;
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
    engines,
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
