"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import { useJob } from "@/lib/useJob";
import type { EditProgress, EditRequest, LoraRef, UpscaleSource } from "@/types";

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
  loras: LoraRef[];
  setSource: (v: UpscaleSource | null) => void;
  setEngine: (v: string) => void;
  setPrompt: (v: string) => void;
  setSteps: (v: number) => void;
  setGuidance: (v: number) => void;
  setSeed: (v: string) => void;
  setBatch: (v: number) => void;
  setLoras: (v: LoraRef[]) => void;
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
  const [source, setSource] = useState<UpscaleSource | null>(null);
  const [engine, setEngine] = useState("");
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState(28);
  const [guidance, setGuidance] = useState(2.5);
  const [seed, setSeed] = useState("");
  const [batch, setBatch] = useState(1);
  const [loras, setLoras] = useState<LoraRef[]>([]);

  // The whole job lifecycle (start/track/rehydrate/bubble/reset) is the shared hook.
  const { progress, resultId, resultIds, error, running, start, reset } = useJob<
    EditProgress,
    EditRequest
  >({
    kind: "edit",
    startRequest: api.edit,
    getProgress: api.getEditProgress,
    pollMs: 700,
    onDone: onEdited,
    activity: { route: "/edit", titleKey: "activity.edit" },
  });

  const value = useMemo<EditContextValue>(
    () => ({
      source,
      engine,
      prompt,
      steps,
      guidance,
      seed,
      batch,
      loras,
      setSource,
      setEngine,
      setPrompt,
      setSteps,
      setGuidance,
      setSeed,
      setBatch,
      setLoras,
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
      loras,
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
