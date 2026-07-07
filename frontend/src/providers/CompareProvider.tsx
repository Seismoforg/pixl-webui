"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { clearJob, saveJob } from "@/lib/jobPersistence";
import { useJobRehydrate, usePublishJobActivity } from "@/lib/jobHooks";
import { useJobTracker } from "@/lib/ws";
import type { CompareAxis, CompareProgress, CompareRequest } from "@/types";

/**
 * Holds the XYZ-plot compare job lifecycle (running job + live tracking) AND the
 * form selection (model / prompt / base params / axes) in a context that stays
 * mounted for the app's lifetime — mirroring the other feature providers. Because
 * both live here and not in the (unmountable) ComparePanel, a running sweep keeps
 * going when the user switches tabs and the chosen settings survive the round trip.
 */
interface CompareContextValue {
  // form (persisted across navigation)
  slug: string;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  steps: number;
  guidance: number;
  seed: string; // free text; "" → random base seed
  sampler: string;
  axes: CompareAxis[];
  setSlug: (v: string) => void;
  setPrompt: (v: string) => void;
  setNegative: (v: string) => void;
  setWidth: (v: number) => void;
  setHeight: (v: number) => void;
  setSteps: (v: number) => void;
  setGuidance: (v: number) => void;
  setSeed: (v: string) => void;
  setSampler: (v: string) => void;
  setAxes: (v: CompareAxis[]) => void;
  // job
  progress: CompareProgress | null;
  resultIds: string[];
  error: string | null;
  running: boolean;
  start: (req: CompareRequest) => Promise<void>;
  reset: () => void;
}

const CompareContext = createContext<CompareContextValue | null>(null);

const POLL_MS = 800;

export const useCompare = () => {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error("useCompare must be used within CompareProvider");
  return ctx;
};

interface CompareProviderProps {
  onCompared: () => void;
  children: ReactNode;
}

export const CompareProvider = ({ onCompared, children }: CompareProviderProps) => {
  const t = useTranslations();

  const [slug, setSlug] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [steps, setSteps] = useState(30);
  const [guidance, setGuidance] = useState(7);
  const [seed, setSeed] = useState("");
  const [sampler, setSampler] = useState("");
  const [axes, setAxes] = useState<CompareAxis[]>([{ param: "steps", values: [] }]);

  // Seed the base sampler from the backend default once (the provider never
  // unmounts, so this runs a single time and later edits persist).
  useEffect(() => {
    api
      .getSamplers()
      .then((s) => setSampler((cur) => cur || s.default))
      .catch(() => undefined);
  }, []);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<CompareProgress | null>(null);
  const [resultIds, setResultIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const running = jobId !== null;

  useJobTracker<CompareProgress>(
    jobId,
    "compare",
    (id) => api.getCompareProgress(id),
    (p) => {
      setProgress(p);
      if (p.status === "done") {
        setResultIds(p.image_ids);
        setJobId(null);
        clearJob("compare");
        onCompared();
      } else if (p.status === "error") {
        setError(p.error ?? t("common.error"));
        setJobId(null);
        clearJob("compare");
      }
    },
    (message) => {
      setError(message);
      setJobId(null);
      clearJob("compare");
    },
    POLL_MS,
  );

  useJobRehydrate("compare", (id) => api.getCompareProgress(id), setJobId);
  usePublishJobActivity("compare", "/compare", "activity.compare", running, progress);

  const start = useCallback(async (req: CompareRequest) => {
    setError(null);
    setResultIds([]);
    setProgress(null);
    try {
      const { job_id } = await api.compare(req);
      setJobId(job_id);
      saveJob("compare", job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const reset = useCallback(() => {
    setResultIds([]);
    setError(null);
    setProgress(null);
  }, []);

  const value = useMemo<CompareContextValue>(
    () => ({
      slug,
      prompt,
      negative,
      width,
      height,
      steps,
      guidance,
      seed,
      sampler,
      axes,
      setSlug,
      setPrompt,
      setNegative,
      setWidth,
      setHeight,
      setSteps,
      setGuidance,
      setSeed,
      setSampler,
      setAxes,
      progress,
      resultIds,
      error,
      running,
      start,
      reset,
    }),
    [
      slug,
      prompt,
      negative,
      width,
      height,
      steps,
      guidance,
      seed,
      sampler,
      axes,
      progress,
      resultIds,
      error,
      running,
      start,
      reset,
    ],
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
};
