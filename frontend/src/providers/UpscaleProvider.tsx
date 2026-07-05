"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { useActivity } from "@/providers/ActivityProvider";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { clearJob, loadJob, saveJob } from "@/lib/jobPersistence";
import { useJobTracker } from "@/lib/ws";
import { upscaleStatsView } from "@/lib/stats";
import type { UpscaleProgress, UpscaleRequest } from "@/types";

/** Chosen source image: an existing gallery image, or an uploaded data URL. */
export type UpscaleSource =
  | { kind: "gallery"; imageId: string; preview: string }
  | { kind: "upload"; dataUrl: string };

/**
 * Holds the upscale job lifecycle (running job + polling loop) AND the form
 * selection (engine / source / prompt / tiling) in a context that stays mounted
 * for the app's lifetime — mirroring GenerationProvider. Because both the polling
 * and the form live here and not in the (unmountable) UpscalePanel, an upscale
 * keeps running when the user switches tabs and the chosen engine/image/settings
 * survive the round trip so returning to /upscale restores everything.
 */
interface UpscaleContextValue {
  // form (persisted across navigation)
  engineSlug: string;
  source: UpscaleSource | null;
  prompt: string;
  tile: boolean;
  sdX4Steps: number; // per-run SD x4 steps; seeded from the global default
  setEngineSlug: (v: string) => void;
  setSource: (v: UpscaleSource | null) => void;
  setPrompt: (v: string) => void;
  setTile: (v: boolean) => void;
  setSdX4Steps: (v: number) => void;
  // job
  progress: UpscaleProgress | null;
  resultId: string | null;
  error: string | null;
  running: boolean;
  start: (req: UpscaleRequest) => Promise<void>;
  reset: () => void;
}

const UpscaleContext = createContext<UpscaleContextValue | null>(null);

const POLL_MS = 700;

export const useUpscale = () => {
  const ctx = useContext(UpscaleContext);
  if (!ctx) throw new Error("useUpscale must be used within UpscaleProvider");
  return ctx;
}

interface UpscaleProviderProps {
  onUpscaled: () => void;
  children: ReactNode;
}

export const UpscaleProvider = ({ onUpscaled, children }: UpscaleProviderProps) => {
  const t = useTranslations();

  const [engineSlug, setEngineSlug] = useState("");
  const [source, setSource] = useState<UpscaleSource | null>(null);
  const [prompt, setPrompt] = useState("");
  const [tile, setTile] = useState(true);
  const [sdX4Steps, setSdX4Steps] = useState(50);

  // Seed the per-run SD x4 step count from the global default once. The provider
  // never unmounts, so this runs a single time and later per-run edits persist.
  useEffect(() => {
    api.getSettings().then((s) => setSdX4Steps(s.sd_x4_steps)).catch(() => undefined);
  }, []);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpscaleProgress | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = jobId !== null;

  // Track the running upscale job over the WebSocket, with a REST poll fallback
  // while the socket is down (see useJobTracker).
  useJobTracker<UpscaleProgress>(
    jobId,
    "upscale",
    (id) => api.getUpscaleProgress(id),
    (p) => {
      setProgress(p);
      if (p.status === "done") {
        setResultId(p.image_id);
        setJobId(null);
        clearJob("upscale");
        onUpscaled();
      } else if (p.status === "error") {
        setError(p.error ?? t("common.error"));
        setJobId(null);
        clearJob("upscale");
      }
    },
    (message) => {
      setError(message);
      setJobId(null);
      clearJob("upscale");
    },
    POLL_MS,
  );

  // Re-attach to a job that was still running when the page reloaded (see the
  // generation provider for the rationale).
  useEffect(() => {
    const saved = loadJob("upscale");
    if (!saved) return undefined;
    let active = true;
    api
      .getUpscaleProgress(saved)
      .then((p) => {
        if (!active) return;
        if (p.status === "running") setJobId(saved);
        else clearJob("upscale");
      })
      .catch(() => active && clearJob("upscale"));
    return () => {
      active = false;
    };
  }, []);

  // Publish the running job to the shared activity store for the off-route bubble.
  const { set: setActivity } = useActivity();
  useEffect(() => {
    if (!running) {
      setActivity("upscale", null);
      return;
    }
    const view = upscaleStatsView(progress, t);
    setActivity("upscale", {
      id: "upscale",
      title: t("activity.upscale"),
      route: "/upscale",
      status: "running",
      detail: view.speed ? `${view.label} · ${view.speed}` : view.label,
      percent: view.percent,
    });
  }, [running, progress, setActivity, t]);

  const start = useCallback(async (req: UpscaleRequest) => {
    setError(null);
    setResultId(null);
    setProgress(null);
    try {
      const { job_id } = await api.upscale(req);
      setJobId(job_id);
      saveJob("upscale", job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const reset = useCallback(() => {
    setResultId(null);
    setError(null);
    setProgress(null);
  }, []);

  const value: UpscaleContextValue = {
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
    progress,
    resultId,
    error,
    running,
    start,
    reset,
  };

  return <UpscaleContext.Provider value={value}>{children}</UpscaleContext.Provider>;
}
