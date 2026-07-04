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
import { live } from "@/lib/ws";
import { upscaleStatsView } from "@/lib/stats";
import type { ReframeStrategy, UpscaleProgress, UpscaleRequest } from "@/types";

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
  outpaintPrompt: string;
  outpaintEngine: string;
  tile: boolean;
  targetRatio: string;
  reframe: ReframeStrategy;
  setEngineSlug: (v: string) => void;
  setSource: (v: UpscaleSource | null) => void;
  setPrompt: (v: string) => void;
  setOutpaintPrompt: (v: string) => void;
  setOutpaintEngine: (v: string) => void;
  setTile: (v: boolean) => void;
  setTargetRatio: (v: string) => void;
  setReframe: (v: ReframeStrategy) => void;
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
  const [outpaintPrompt, setOutpaintPrompt] = useState("");
  const [outpaintEngine, setOutpaintEngine] = useState("");
  const [tile, setTile] = useState(true);
  const [targetRatio, setTargetRatio] = useState("original");
  const [reframe, setReframe] = useState<ReframeStrategy>("cover");

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpscaleProgress | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = jobId !== null;

  useEffect(() => {
    if (!jobId) return undefined;
    const handle = (p: UpscaleProgress) => {
      setProgress(p);
      if (p.status === "done") {
        setResultId(p.image_id);
        setJobId(null);
        onUpscaled();
      } else if (p.status === "error") {
        setError(p.error ?? t("common.error"));
        setJobId(null);
      }
    };
    const unsub = live.subscribe(
      `upscale:${jobId}`,
      { channel: "upscale", job_id: jobId },
      (d) => handle(d as UpscaleProgress),
    );
    const id = setInterval(() => {
      if (live.isConnected()) return;
      api
        .getUpscaleProgress(jobId)
        .then(handle)
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          setJobId(null);
        });
    }, POLL_MS);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [jobId, onUpscaled, t]);

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
    progress,
    resultId,
    error,
    running,
    start,
    reset,
  };

  return <UpscaleContext.Provider value={value}>{children}</UpscaleContext.Provider>;
}
