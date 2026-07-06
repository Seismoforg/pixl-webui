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
import type { InpaintProgress, InpaintRequest, Sampler } from "@/types";
import type { UpscaleSource } from "@/providers/UpscaleProvider";

/**
 * Holds the inpaint job lifecycle (running job + live tracking) AND the form
 * selection (source / painted mask / engine / prompt / brush + feather + generation
 * params) in a context that stays mounted for the app's lifetime — mirroring
 * ReframeProvider. Inpainting repaints a hand-painted region of an image; the job
 * reuses the upscale progress shape so the shared live-stats UI works unchanged.
 */
interface InpaintContextValue {
  // form (persisted across navigation)
  source: UpscaleSource | null;
  maskData: string | null; // painted mask as a data URL (white = repaint)
  engine: string;
  prompt: string;
  negative: string;
  // Brush controls (canvas-space px / 0–100 %).
  brushSize: number;
  brushSoftness: number;
  // Feather tuning as 0–100 percent (50 = tuned default).
  maskFeather: number;
  seamFeather: number;
  seedBlur: number;
  maskExpand: number; // grow the painted region before generating (0–100 %)
  // Generation parameters.
  steps: number;
  refineSteps: number;
  refine: boolean; // run the slow full-res hires refine pass (default off)
  guidance: number;
  sampler: string;
  seed: string; // free text: empty = random, else a number
  batch: number;
  samplers: Sampler[];
  setSource: (v: UpscaleSource | null) => void;
  setMaskData: (v: string | null) => void;
  setEngine: (v: string) => void;
  setPrompt: (v: string) => void;
  setNegative: (v: string) => void;
  setBrushSize: (v: number) => void;
  setBrushSoftness: (v: number) => void;
  setMaskFeather: (v: number) => void;
  setSeamFeather: (v: number) => void;
  setSeedBlur: (v: number) => void;
  setMaskExpand: (v: number) => void;
  setSteps: (v: number) => void;
  setRefineSteps: (v: number) => void;
  setRefine: (v: boolean) => void;
  setGuidance: (v: number) => void;
  setSampler: (v: string) => void;
  setSeed: (v: string) => void;
  setBatch: (v: number) => void;
  // job
  progress: InpaintProgress | null;
  resultId: string | null;
  resultIds: string[];
  error: string | null;
  running: boolean;
  start: (req: InpaintRequest) => Promise<void>;
  reset: () => void;
}

const InpaintContext = createContext<InpaintContextValue | null>(null);

const POLL_MS = 700;

export const useInpaint = () => {
  const ctx = useContext(InpaintContext);
  if (!ctx) throw new Error("useInpaint must be used within InpaintProvider");
  return ctx;
};

interface InpaintProviderProps {
  onInpainted: () => void;
  children: ReactNode;
}

export const InpaintProvider = ({ onInpainted, children }: InpaintProviderProps) => {
  const t = useTranslations();

  const [source, setSource] = useState<UpscaleSource | null>(null);
  const [maskData, setMaskData] = useState<string | null>(null);
  const [engine, setEngine] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [brushSize, setBrushSize] = useState(48);
  const [brushSoftness, setBrushSoftness] = useState(50);
  // Inpaint-tuned feather defaults (lower than the 50 % outpaint tuning): the edit
  // should stay contained near the painted area and respect surrounding context, so
  // a tighter mask gradient, a moderate composite seam, and a low seed blur.
  const [maskFeather, setMaskFeather] = useState(35);
  const [seamFeather, setSeamFeather] = useState(40);
  const [seedBlur, setSeedBlur] = useState(20);
  // Grow the mask outward a little by default so a subject's soft fringe (fur/hair)
  // doesn't remain as a halo of the original after compositing.
  const [maskExpand, setMaskExpand] = useState(30);
  const [steps, setSteps] = useState(30);
  const [refineSteps, setRefineSteps] = useState(24);
  const [refine, setRefine] = useState(false);
  const [guidance, setGuidance] = useState(7.5);
  const [sampler, setSampler] = useState("");
  const [seed, setSeed] = useState("");
  const [batch, setBatch] = useState(1);
  const [samplers, setSamplers] = useState<Sampler[]>([]);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<InpaintProgress | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [resultIds, setResultIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load the sampler list once; seed the default into the (empty) selection.
  useEffect(() => {
    api
      .getSamplers()
      .then((list) => {
        setSamplers(list.samplers);
        setSampler((cur) => cur || list.default);
      })
      .catch(() => setSamplers([]));
  }, []);

  const running = jobId !== null;

  useJobTracker<InpaintProgress>(
    jobId,
    "inpaint",
    (id) => api.getInpaintProgress(id),
    (p) => {
      setProgress(p);
      setResultIds(p.image_ids);
      if (p.status === "done") {
        setResultId(p.image_id ?? p.image_ids[0] ?? null);
        setJobId(null);
        clearJob("inpaint");
        onInpainted();
      } else if (p.status === "error") {
        setError(p.error ?? t("common.error"));
        setJobId(null);
        clearJob("inpaint");
      }
    },
    (message) => {
      setError(message);
      setJobId(null);
      clearJob("inpaint");
    },
    POLL_MS,
  );

  // Re-attach to a job that was still running when the page reloaded.
  useJobRehydrate("inpaint", (id) => api.getInpaintProgress(id), setJobId);

  // Publish the running job to the shared activity store for the off-route bubble.
  usePublishJobActivity("inpaint", "/inpaint", "activity.inpaint", running, progress);

  const start = useCallback(async (req: InpaintRequest) => {
    setError(null);
    setResultId(null);
    setResultIds([]);
    setProgress(null);
    try {
      const { job_id } = await api.inpaint(req);
      setJobId(job_id);
      saveJob("inpaint", job_id);
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

  const value = useMemo<InpaintContextValue>(
    () => ({
      source,
      maskData,
      engine,
      prompt,
      negative,
      brushSize,
      brushSoftness,
      maskFeather,
      seamFeather,
      seedBlur,
      maskExpand,
      steps,
      refineSteps,
      refine,
      guidance,
      sampler,
      seed,
      batch,
      samplers,
      setSource,
      setMaskData,
      setEngine,
      setPrompt,
      setNegative,
      setBrushSize,
      setBrushSoftness,
      setMaskFeather,
      setSeamFeather,
      setSeedBlur,
      setMaskExpand,
      setSteps,
      setRefineSteps,
      setRefine,
      setGuidance,
      setSampler,
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
      maskData,
      engine,
      prompt,
      negative,
      brushSize,
      brushSoftness,
      maskFeather,
      seamFeather,
      seedBlur,
      maskExpand,
      steps,
      refineSteps,
      refine,
      guidance,
      sampler,
      seed,
      batch,
      samplers,
      progress,
      resultId,
      resultIds,
      error,
      running,
      start,
      reset,
    ],
  );

  return <InpaintContext.Provider value={value}>{children}</InpaintContext.Provider>;
};
