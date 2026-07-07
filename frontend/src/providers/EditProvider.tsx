"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { clearJob, saveJob } from "@/lib/jobPersistence";
import { useJobRehydrate, usePublishJobActivity } from "@/lib/jobHooks";
import { useJobTracker } from "@/lib/ws";
import type { EditProgress, EditRequest } from "@/types";
import type { UpscaleSource } from "@/providers/UpscaleProvider";

/**
 * Holds the Post-Processing (FLUX Kontext) edit job lifecycle (running job + live
 * tracking) AND the form selection (source / engine / instruction prompt +
 * generation params) in a context that stays mounted for the app's lifetime —
 * mirroring InpaintProvider. Kontext edits a whole image from a natural-language
 * instruction (no mask, no sampler — flow-matching FLUX); the job reuses the upscale
 * progress shape so the shared live-stats UI works unchanged.
 */
interface EditContextValue {
  // form (persisted across navigation)
  source: UpscaleSource | null;
  engine: string;
  prompt: string;
  steps: number;
  guidance: number;
  seed: string; // free text: empty = random, else a number
  batch: number;
  setSource: (v: UpscaleSource | null) => void;
  setEngine: (v: string) => void;
  setPrompt: (v: string) => void;
  setSteps: (v: number) => void;
  setGuidance: (v: number) => void;
  setSeed: (v: string) => void;
  setBatch: (v: number) => void;
  // job
  progress: EditProgress | null;
  resultId: string | null;
  resultIds: string[];
  error: string | null;
  running: boolean;
  start: (req: EditRequest) => Promise<void>;
  reset: () => void;
}

const EditContext = createContext<EditContextValue | null>(null);

const POLL_MS = 700;

export const useEdit = () => {
  const ctx = useContext(EditContext);
  if (!ctx) throw new Error("useEdit must be used within EditProvider");
  return ctx;
};

interface EditProviderProps {
  onEdited: () => void;
  children: ReactNode;
}

export const EditProvider = ({ onEdited, children }: EditProviderProps) => {
  const t = useTranslations();

  const [source, setSource] = useState<UpscaleSource | null>(null);
  const [engine, setEngine] = useState("");
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState(28);
  const [guidance, setGuidance] = useState(2.5);
  const [seed, setSeed] = useState("");
  const [batch, setBatch] = useState(1);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<EditProgress | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [resultIds, setResultIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const running = jobId !== null;

  useJobTracker<EditProgress>(
    jobId,
    "edit",
    (id) => api.getEditProgress(id),
    (p) => {
      setProgress(p);
      setResultIds(p.image_ids);
      if (p.status === "done") {
        setResultId(p.image_id ?? p.image_ids[0] ?? null);
        setJobId(null);
        clearJob("edit");
        onEdited();
      } else if (p.status === "error") {
        setError(p.error ?? t("common.error"));
        setJobId(null);
        clearJob("edit");
      }
    },
    (message) => {
      setError(message);
      setJobId(null);
      clearJob("edit");
    },
    POLL_MS,
  );

  // Re-attach to a job that was still running when the page reloaded.
  useJobRehydrate("edit", (id) => api.getEditProgress(id), setJobId);

  // Publish the running job to the shared activity store for the off-route bubble.
  usePublishJobActivity("edit", "/edit", "activity.edit", running, progress);

  const start = useCallback(async (req: EditRequest) => {
    setError(null);
    setResultId(null);
    setResultIds([]);
    setProgress(null);
    try {
      const { job_id } = await api.edit(req);
      setJobId(job_id);
      saveJob("edit", job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const reset = useCallback(() => {
    setResultId(null);
    setResultIds([]);
    setError(null);
    setProgress(null);
  }, []);

  const value = useMemo<EditContextValue>(
    () => ({
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
      progress,
      resultId,
      resultIds,
      error,
      running,
      start,
      reset,
    }),
    [
      source,
      engine,
      prompt,
      steps,
      guidance,
      seed,
      batch,
      progress,
      resultId,
      resultIds,
      error,
      running,
      start,
      reset,
    ],
  );

  return <EditContext.Provider value={value}>{children}</EditContext.Provider>;
};
