"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import { useJob } from "@/lib/useJob";
import type {
  RestoreProgress,
  RestoreRequest,
  RestoreStation,
  StationOverride,
  UpscaleSource,
} from "@/types";

/**
 * Holds the restore job lifecycle AND the form (source / preset / per-station
 * conveyor overrides / beautify prompt) in a context mounted for the app's
 * lifetime — mirroring UpscaleProvider — so a restoration keeps running across
 * navigation and the chosen settings survive the round trip to /restore.
 */
interface RestoreContextValue {
  source: UpscaleSource | null;
  preset: string;
  stations: Partial<Record<RestoreStation, StationOverride>>;
  beautifyPrompt: string;
  // Per-role model overrides (slug; "" = Auto / first downloaded).
  faceEngine: string;
  upscaleEngine: string;
  editEngine: string;
  colorizeEngine: string;
  setSource: (v: UpscaleSource | null) => void;
  setPreset: (v: string) => void;
  setStationOverride: (station: RestoreStation, override: StationOverride | null) => void;
  resetStationOverrides: () => void;
  setBeautifyPrompt: (v: string) => void;
  setFaceEngine: (v: string) => void;
  setUpscaleEngine: (v: string) => void;
  setEditEngine: (v: string) => void;
  setColorizeEngine: (v: string) => void;
  // job
  progress: RestoreProgress | null;
  resultId: string | null;
  error: string | null;
  running: boolean;
  start: (req: RestoreRequest) => Promise<void>;
  reset: () => void;
}

const RestoreContext = createContext<RestoreContextValue | null>(null);

export const useRestore = () => {
  const ctx = useContext(RestoreContext);
  if (!ctx) throw new Error("useRestore must be used within RestoreProvider");
  return ctx;
};

interface RestoreProviderProps {
  onRestored: () => void;
  children: ReactNode;
}

export const RestoreProvider = ({ onRestored, children }: RestoreProviderProps) => {
  const [source, setSource] = useState<UpscaleSource | null>(null);
  const [preset, setPreset] = useState("balanced");
  const [stations, setStations] = useState<Partial<Record<RestoreStation, StationOverride>>>({});
  const [beautifyPrompt, setBeautifyPrompt] = useState("");
  const [faceEngine, setFaceEngine] = useState("");
  const [upscaleEngine, setUpscaleEngine] = useState("");
  const [editEngine, setEditEngine] = useState("");
  const [colorizeEngine, setColorizeEngine] = useState("");

  // Merge/clear one station's override (null clears it → back to preset defaults).
  const setStationOverride = (station: RestoreStation, override: StationOverride | null) =>
    setStations((prev) => {
      const next = { ...prev };
      if (override === null) delete next[station];
      else next[station] = { ...next[station], ...override };
      return next;
    });

  const resetStationOverrides = () => setStations({});

  const { progress, resultId, error, running, start, reset } = useJob<
    RestoreProgress,
    RestoreRequest
  >({
    kind: "restore",
    startRequest: api.restore,
    getProgress: api.getRestoreProgress,
    pollMs: 700,
    onDone: onRestored,
    activity: { route: "/restore", titleKey: "activity.restore" },
  });

  const value = useMemo<RestoreContextValue>(
    () => ({
      source,
      preset,
      stations,
      beautifyPrompt,
      faceEngine,
      upscaleEngine,
      editEngine,
      colorizeEngine,
      setSource,
      setPreset,
      setStationOverride,
      resetStationOverrides,
      setBeautifyPrompt,
      setFaceEngine,
      setUpscaleEngine,
      setEditEngine,
      setColorizeEngine,
      progress,
      resultId,
      error,
      running,
      start,
      reset,
    }),
    [
      source,
      preset,
      stations,
      beautifyPrompt,
      faceEngine,
      upscaleEngine,
      editEngine,
      colorizeEngine,
      progress,
      resultId,
      error,
      running,
      start,
      reset,
    ],
  );

  return <RestoreContext.Provider value={value}>{children}</RestoreContext.Provider>;
};
