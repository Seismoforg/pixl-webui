"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import { useJob } from "@/lib/useJob";
import { useSamplers } from "@/lib/useSamplers";
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
  saveIndividuals: boolean;
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
  setSaveIndividuals: (v: boolean) => void;
  // job
  progress: CompareProgress | null;
  resultIds: string[];
  error: string | null;
  running: boolean;
  start: (req: CompareRequest) => Promise<void>;
  reset: () => void;
}

const CompareContext = createContext<CompareContextValue | null>(null);

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
  const [saveIndividuals, setSaveIndividuals] = useState(true);

  // Seed the base sampler from the backend default once (the provider never
  // unmounts, so this runs a single time and later edits persist).
  useSamplers((d) => setSampler((cur) => cur || d));

  // The whole job lifecycle (start/track/rehydrate/bubble/reset) is the shared hook.
  // resultIdsLive=false: sheets only exist once the sweep is done.
  const { progress, resultIds, error, running, start, reset } = useJob<
    CompareProgress,
    CompareRequest
  >({
    kind: "compare",
    startRequest: api.compare,
    getProgress: api.getCompareProgress,
    pollMs: 800,
    onDone: onCompared,
    resultIdsLive: false,
    activity: { route: "/compare", titleKey: "activity.compare" },
  });

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
      saveIndividuals,
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
      setSaveIndividuals,
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
      saveIndividuals,
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
