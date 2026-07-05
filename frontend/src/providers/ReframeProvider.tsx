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
import { useJobTracker } from "@/lib/ws";
import { upscaleStatsView } from "@/lib/stats";
import type { ReframeRequest, ReframeStrategy, UpscaleProgress } from "@/types";
import type { UpscaleSource } from "@/providers/UpscaleProvider";

/**
 * Holds the reframe job lifecycle (running job + live tracking) AND the form
 * selection (source / target ratio / strategy / outpaint) in a context that stays
 * mounted for the app's lifetime — mirroring UpscaleProvider. Reframing changes an
 * image's aspect ratio (cover/contain/edge/outpaint) WITHOUT upscaling; the job
 * reuses the upscale progress shape so the shared live-stats UI works unchanged.
 */
interface ReframeContextValue {
  // form (persisted across navigation)
  source: UpscaleSource | null;
  targetRatio: string;
  reframe: ReframeStrategy;
  outpaintPrompt: string;
  outpaintEngine: string;
  setSource: (v: UpscaleSource | null) => void;
  setTargetRatio: (v: string) => void;
  setReframe: (v: ReframeStrategy) => void;
  setOutpaintPrompt: (v: string) => void;
  setOutpaintEngine: (v: string) => void;
  // job
  progress: UpscaleProgress | null;
  resultId: string | null;
  error: string | null;
  running: boolean;
  start: (req: ReframeRequest) => Promise<void>;
  reset: () => void;
}

const ReframeContext = createContext<ReframeContextValue | null>(null);

const POLL_MS = 700;

export const useReframe = () => {
  const ctx = useContext(ReframeContext);
  if (!ctx) throw new Error("useReframe must be used within ReframeProvider");
  return ctx;
};

interface ReframeProviderProps {
  onReframed: () => void;
  children: ReactNode;
}

export const ReframeProvider = ({ onReframed, children }: ReframeProviderProps) => {
  const t = useTranslations();

  const [source, setSource] = useState<UpscaleSource | null>(null);
  // Reframing always changes the ratio, so default to a concrete one (not "original").
  const [targetRatio, setTargetRatio] = useState("16:9");
  const [reframe, setReframe] = useState<ReframeStrategy>("cover");
  const [outpaintPrompt, setOutpaintPrompt] = useState("");
  const [outpaintEngine, setOutpaintEngine] = useState("");

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpscaleProgress | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = jobId !== null;

  useJobTracker<UpscaleProgress>(
    jobId,
    "reframe",
    (id) => api.getReframeProgress(id),
    (p) => {
      setProgress(p);
      if (p.status === "done") {
        setResultId(p.image_id);
        setJobId(null);
        onReframed();
      } else if (p.status === "error") {
        setError(p.error ?? t("common.error"));
        setJobId(null);
      }
    },
    (message) => {
      setError(message);
      setJobId(null);
    },
    POLL_MS,
  );

  // Publish the running job to the shared activity store for the off-route bubble.
  const { set: setActivity } = useActivity();
  useEffect(() => {
    if (!running) {
      setActivity("reframe", null);
      return;
    }
    const view = upscaleStatsView(progress, t);
    setActivity("reframe", {
      id: "reframe",
      title: t("activity.reframe"),
      route: "/reframe",
      status: "running",
      detail: view.speed ? `${view.label} · ${view.speed}` : view.label,
      percent: view.percent,
    });
  }, [running, progress, setActivity, t]);

  const start = useCallback(async (req: ReframeRequest) => {
    setError(null);
    setResultId(null);
    setProgress(null);
    try {
      const { job_id } = await api.reframe(req);
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

  const value: ReframeContextValue = {
    source,
    targetRatio,
    reframe,
    outpaintPrompt,
    outpaintEngine,
    setSource,
    setTargetRatio,
    setReframe,
    setOutpaintPrompt,
    setOutpaintEngine,
    progress,
    resultId,
    error,
    running,
    start,
    reset,
  };

  return <ReframeContext.Provider value={value}>{children}</ReframeContext.Provider>;
};
