"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import { useJob } from "@/lib/useJob";
import type { UpscaleProgress, UpscaleRequest, UpscaleSource } from "@/types";

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
  fidelity: number; // CodeFormer face-restore identity↔smoothness weight (0..1)
  setEngineSlug: (v: string) => void;
  setSource: (v: UpscaleSource | null) => void;
  setPrompt: (v: string) => void;
  setTile: (v: boolean) => void;
  setSdX4Steps: (v: number) => void;
  setFidelity: (v: number) => void;
  // job
  progress: UpscaleProgress | null;
  resultId: string | null;
  error: string | null;
  running: boolean;
  start: (req: UpscaleRequest) => Promise<void>;
  reset: () => void;
}

const UpscaleContext = createContext<UpscaleContextValue | null>(null);

export const useUpscale = () => {
  const ctx = useContext(UpscaleContext);
  if (!ctx) throw new Error("useUpscale must be used within UpscaleProvider");
  return ctx;
};

interface UpscaleProviderProps {
  onUpscaled: () => void;
  children: ReactNode;
}

export const UpscaleProvider = ({ onUpscaled, children }: UpscaleProviderProps) => {
  const [engineSlug, setEngineSlug] = useState("");
  const [source, setSource] = useState<UpscaleSource | null>(null);
  const [prompt, setPrompt] = useState("");
  const [tile, setTile] = useState(true);
  const [sdX4Steps, setSdX4Steps] = useState(50);
  // CodeFormer face-restore fidelity (identity-leaning default, mirrors the backend).
  const [fidelity, setFidelity] = useState(0.7);

  // Seed the per-run SD x4 step count from the global default once. The provider
  // never unmounts, so this runs a single time and later per-run edits persist.
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setSdX4Steps(s.sd_x4_steps))
      .catch(() => undefined);
  }, []);

  // The whole job lifecycle (start/track/rehydrate/bubble/reset) is the shared hook.
  const { progress, resultId, error, running, start, reset } = useJob<
    UpscaleProgress,
    UpscaleRequest
  >({
    kind: "upscale",
    startRequest: api.upscale,
    getProgress: api.getUpscaleProgress,
    pollMs: 700,
    onDone: onUpscaled,
    activity: { route: "/upscale", titleKey: "activity.upscale" },
  });

  const value = useMemo<UpscaleContextValue>(
    () => ({
      engineSlug,
      source,
      prompt,
      tile,
      sdX4Steps,
      fidelity,
      setEngineSlug,
      setSource,
      setPrompt,
      setTile,
      setSdX4Steps,
      setFidelity,
      progress,
      resultId,
      error,
      running,
      start,
      reset,
    }),
    [
      engineSlug,
      source,
      prompt,
      tile,
      sdX4Steps,
      fidelity,
      progress,
      resultId,
      error,
      running,
      start,
      reset,
    ],
  );

  return <UpscaleContext.Provider value={value}>{children}</UpscaleContext.Provider>;
};
