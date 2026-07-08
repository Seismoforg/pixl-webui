"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import { useJob } from "@/lib/useJob";
import { useSamplers } from "@/lib/useSamplers";
import type {
  ReframeProgress,
  ReframeRequest,
  ReframeStrategy,
  Sampler,
  UpscaleSource,
} from "@/types";

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
  // Custom exact output resolution (px), used when targetRatio === "custom".
  customWidth: number;
  customHeight: number;
  reframe: ReframeStrategy;
  outpaintPrompt: string;
  outpaintNegative: string;
  outpaintEngine: string;
  // Outpaint seam-blend tuning as 0–100 percent (50 = tuned default).
  maskFeather: number;
  seamFeather: number;
  seedBlur: number;
  // Source placement as 0–100 percent (50 = centred).
  posX: number;
  posY: number;
  // Source scale as 0–100 percent (100 = fills the frame). < 100 shrinks the source
  // within the frame so it can be positioned (area-adding strategies).
  scale: number;
  // Outpaint generation parameters (only used by reframe=outpaint).
  outpaintSteps: number;
  outpaintRefineSteps: number;
  outpaintRefine: boolean; // run the slow full-res hires refine pass (default off)
  outpaintGuidance: number;
  outpaintSampler: string;
  outpaintSeed: string; // free text: empty = random, else a number
  outpaintBatch: number;
  samplers: Sampler[];
  setSource: (v: UpscaleSource | null) => void;
  setTargetRatio: (v: string) => void;
  setCustomWidth: (v: number) => void;
  setCustomHeight: (v: number) => void;
  setReframe: (v: ReframeStrategy) => void;
  setOutpaintPrompt: (v: string) => void;
  setOutpaintNegative: (v: string) => void;
  setOutpaintEngine: (v: string) => void;
  setMaskFeather: (v: number) => void;
  setSeamFeather: (v: number) => void;
  setSeedBlur: (v: number) => void;
  setPosX: (v: number) => void;
  setPosY: (v: number) => void;
  setScale: (v: number) => void;
  setOutpaintSteps: (v: number) => void;
  setOutpaintRefineSteps: (v: number) => void;
  setOutpaintRefine: (v: boolean) => void;
  setOutpaintGuidance: (v: number) => void;
  setOutpaintSampler: (v: string) => void;
  setOutpaintSeed: (v: string) => void;
  setOutpaintBatch: (v: number) => void;
  // job
  progress: ReframeProgress | null;
  resultId: string | null;
  resultIds: string[]; // all batch result image ids (in order), for the result grid
  error: string | null;
  running: boolean;
  start: (req: ReframeRequest) => Promise<void>;
  reset: () => void;
}

const ReframeContext = createContext<ReframeContextValue | null>(null);

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
  const [source, setSource] = useState<UpscaleSource | null>(null);
  // Reframing always changes the ratio, so default to a concrete one (not "original").
  const [targetRatio, setTargetRatio] = useState("16:9");
  // Custom exact resolution (px); only used when targetRatio === "custom".
  const [customWidth, setCustomWidth] = useState(1024);
  const [customHeight, setCustomHeight] = useState(1024);
  const [reframe, setReframe] = useState<ReframeStrategy>("cover");
  const [outpaintPrompt, setOutpaintPrompt] = useState("");
  const [outpaintNegative, setOutpaintNegative] = useState("");
  const [outpaintEngine, setOutpaintEngine] = useState("");
  // 50 % = the tuned defaults from the gradient-seam-blending feature.
  const [maskFeather, setMaskFeather] = useState(50);
  const [seamFeather, setSeamFeather] = useState(50);
  const [seedBlur, setSeedBlur] = useState(50);
  // 50 % = centred (matches the backend's old //2 placement).
  const [posX, setPosX] = useState(50);
  const [posY, setPosY] = useState(50);
  // 100 % = the source fills the frame (current behavior); lower shrinks it.
  const [scale, setScale] = useState(100);
  // Outpaint generation parameters, defaulting to the backend constants.
  const [outpaintSteps, setOutpaintSteps] = useState(30);
  const [outpaintRefineSteps, setOutpaintRefineSteps] = useState(24);
  // Off by default: the refine pass is a slow full-resolution second inpaint.
  const [outpaintRefine, setOutpaintRefine] = useState(false);
  const [outpaintGuidance, setOutpaintGuidance] = useState(7.5);
  const [outpaintSampler, setOutpaintSampler] = useState("");
  const [outpaintSeed, setOutpaintSeed] = useState("");
  const [outpaintBatch, setOutpaintBatch] = useState(1);

  // Sampler list + default seed into the (empty) selection so the outpaint sampler
  // dropdown starts on the same default as generation.
  const samplers: Sampler[] = useSamplers((d) => setOutpaintSampler((cur) => cur || d));

  // The whole job lifecycle (start/track/rehydrate/bubble/reset) is the shared hook;
  // resultIds fill live as each batch variant finishes.
  const { progress, resultId, resultIds, error, running, start, reset } = useJob<
    ReframeProgress,
    ReframeRequest
  >({
    kind: "reframe",
    startRequest: api.reframe,
    getProgress: api.getReframeProgress,
    pollMs: 700,
    onDone: onReframed,
    activity: { route: "/reframe", titleKey: "activity.reframe" },
  });

  const value = useMemo<ReframeContextValue>(
    () => ({
      source,
      targetRatio,
      customWidth,
      customHeight,
      reframe,
      outpaintPrompt,
      outpaintNegative,
      outpaintEngine,
      maskFeather,
      seamFeather,
      seedBlur,
      posX,
      posY,
      scale,
      outpaintSteps,
      outpaintRefineSteps,
      outpaintRefine,
      outpaintGuidance,
      outpaintSampler,
      outpaintSeed,
      outpaintBatch,
      samplers,
      setSource,
      setTargetRatio,
      setCustomWidth,
      setCustomHeight,
      setReframe,
      setOutpaintPrompt,
      setOutpaintNegative,
      setOutpaintEngine,
      setMaskFeather,
      setSeamFeather,
      setSeedBlur,
      setPosX,
      setPosY,
      setScale,
      setOutpaintSteps,
      setOutpaintRefineSteps,
      setOutpaintRefine,
      setOutpaintGuidance,
      setOutpaintSampler,
      setOutpaintSeed,
      setOutpaintBatch,
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
      targetRatio,
      customWidth,
      customHeight,
      reframe,
      outpaintPrompt,
      outpaintNegative,
      outpaintEngine,
      maskFeather,
      seamFeather,
      seedBlur,
      posX,
      posY,
      scale,
      outpaintSteps,
      outpaintRefineSteps,
      outpaintRefine,
      outpaintGuidance,
      outpaintSampler,
      outpaintSeed,
      outpaintBatch,
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

  return <ReframeContext.Provider value={value}>{children}</ReframeContext.Provider>;
};
