"use client";

// Generic job-lifecycle hook — the shared state machine of the 6 feature providers
// (generation/compare/upscale/reframe/inpaint/edit): job id + progress + result +
// error state, start (POST + persist), live tracking (WS + poll fallback), reload
// rehydrate, activity-bubble publish, reset. Providers keep only their form state
// and feature-specific bootstrapping on top of this.

import { useCallback, useRef, useState } from "react";

import { useTranslations } from "@/i18n";
import { useJobRehydrate, usePublishJobActivity } from "@/lib/jobHooks";
import { clearJob, saveJob } from "@/lib/jobPersistence";
import { useJobTracker } from "@/lib/ws";
import type { GenerationStatus, UpscaleProgress } from "@/types";

/** The minimal progress shape the kernel needs; every feature progress model has it. */
interface JobShape {
  status: GenerationStatus;
  image_id?: string | null;
  image_ids?: string[];
  error?: string | null;
}

interface UseJobOptions<P extends JobShape, Req> {
  /** WS channel + persistence key + activity id ("upscale", "reframe", …). */
  kind: string;
  startRequest: (req: Req) => Promise<{ job_id: string }>;
  getProgress: (id: string) => Promise<P>;
  /** REST poll cadence while the socket is down. */
  pollMs: number;
  onDone?: () => void;
  /** false → fill resultIds only on done (compare); default fills them live. */
  resultIdsLive?: boolean;
  /** Off-route activity bubble; omit when the caller publishes its own (generation). */
  activity?: { route: string; titleKey: string };
}

interface UseJobValue<P, Req> {
  jobId: string | null;
  running: boolean;
  progress: P | null;
  resultId: string | null;
  resultIds: string[];
  error: string | null;
  start: (req: Req) => Promise<void>;
  reset: () => void;
}

export const useJob = <P extends JobShape, Req>(
  options: UseJobOptions<P, Req>,
): UseJobValue<P, Req> => {
  const t = useTranslations();
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<P | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [resultIds, setResultIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const running = jobId !== null;

  // Options are read through a ref so start/reset stay referentially stable (the
  // providers memoize their context value on them) even with inline option objects.
  const opts = useRef(options);
  opts.current = options;

  useJobTracker<P>(
    jobId,
    options.kind,
    (id) => opts.current.getProgress(id),
    (p) => {
      setProgress(p);
      if (opts.current.resultIdsLive !== false) setResultIds(p.image_ids ?? []);
      if (p.status === "done") {
        if (opts.current.resultIdsLive === false) setResultIds(p.image_ids ?? []);
        setResultId(p.image_id ?? p.image_ids?.[0] ?? null);
        setJobId(null);
        clearJob(opts.current.kind);
        opts.current.onDone?.();
      } else if (p.status === "error") {
        setError(p.error ?? t("common.error"));
        setJobId(null);
        clearJob(opts.current.kind);
      }
    },
    (message) => {
      setError(message);
      setJobId(null);
      clearJob(opts.current.kind);
    },
    options.pollMs,
  );

  // Re-attach to a job that was still running when the page reloaded (the backend
  // job keeps going); drop a stale persisted id.
  useJobRehydrate(options.kind, (id) => opts.current.getProgress(id), setJobId);

  // Publish the running job to the shared activity store for the off-route bubble.
  // Every activity-publishing feature's progress is UpscaleProgress-shaped; the
  // one caller without `activity` (generation) never reaches the cast.
  usePublishJobActivity(
    options.kind,
    options.activity?.route ?? "",
    options.activity?.titleKey ?? "",
    running,
    progress as unknown as UpscaleProgress | null,
    options.activity !== undefined,
  );

  const start = useCallback(async (req: Req) => {
    setError(null);
    setResultId(null);
    setResultIds([]);
    setProgress(null);
    try {
      const { job_id } = await opts.current.startRequest(req);
      setJobId(job_id);
      saveJob(opts.current.kind, job_id);
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

  return { jobId, running, progress, resultId, resultIds, error, start, reset };
};
