"use client";

// localStorage-backed persistence of in-flight work so its status bubble survives
// a full page reload: the backend job/download keeps running, so on mount the
// providers re-attach to the stored id. SSR-guarded and best-effort — any failure
// (private mode, quota, disabled storage) is ignored and the app falls back to its
// in-memory-only behaviour.

const PREFIX = "pixl.activity.";

const canUse = (): boolean => typeof window !== "undefined" && !!window.localStorage;

/** The active job id for a feature ("generation" | "upscale" | "reframe"). */
export const loadJob = (key: string): string | null => {
  if (!canUse()) return null;
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
};

export const saveJob = (key: string, id: string): void => {
  if (!canUse()) return;
  try {
    window.localStorage.setItem(PREFIX + key, id);
  } catch {
    /* ignore */
  }
};

export const clearJob = (key: string): void => {
  if (!canUse()) return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
};

// A tracked download as a serializable descriptor; the non-serializable
// fetch/retry closures are rebuilt from `kind` on rehydrate.
export interface PersistedDownload {
  slug: string;
  title: string;
  route: string;
  kind: "upscaler" | "model" | "lora";
}

const DL_KEY = PREFIX + "downloads";

export const loadDownloads = (): PersistedDownload[] => {
  if (!canUse()) return [];
  try {
    const raw = window.localStorage.getItem(DL_KEY);
    return raw ? (JSON.parse(raw) as PersistedDownload[]) : [];
  } catch {
    return [];
  }
};

export const saveDownloads = (list: PersistedDownload[]): void => {
  if (!canUse()) return;
  try {
    window.localStorage.setItem(DL_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
};
