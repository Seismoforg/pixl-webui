"use client";

// Shared job-lifecycle hooks used by the generation/upscale/reframe/inpaint/edit
// providers, factored out to remove near-identical duplication between them.

import { useEffect } from "react";

import { useActivity } from "@/providers/ActivityProvider";
import { useTranslations } from "@/i18n";
import { clearJob, loadJob } from "@/lib/jobPersistence";
import { upscaleStatsView } from "@/lib/stats";
import type { GenerationStatus, UpscaleProgress } from "@/types";

/**
 * Rehydrate a job that was still running when the page reloaded: the backend
 * job keeps going, so re-attach (via `setJobId`) if it is still running,
 * otherwise drop the stale persisted id. Runs once on mount (keyed by `key`,
 * which never changes for a given provider instance).
 */
export const useJobRehydrate = <T extends { status: GenerationStatus }>(
  key: string,
  fetchProgress: (id: string) => Promise<T>,
  setJobId: (id: string) => void,
): void => {
  useEffect(() => {
    const saved = loadJob(key);
    if (!saved) return undefined;
    let active = true;
    fetchProgress(saved)
      .then((p) => {
        if (!active) return;
        if (p.status === "running") setJobId(saved);
        else clearJob(key);
      })
      .catch(() => active && clearJob(key));
    return () => {
      active = false;
    };
    // fetchProgress/setJobId are recreated every render but the providers never
    // unmount and `key` is a constant per feature, so re-running only on `key`
    // matches the original once-on-mount behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
};

/**
 * Publish a running upscale-family job (upscale/reframe/inpaint/edit — they all
 * share the `UpscaleProgress`-shaped stats view) to the shared activity store
 * for the off-route bubble. Not used by generation, which builds its own
 * phase-based detail text instead of `upscaleStatsView`.
 */
export const usePublishJobActivity = (
  id: string,
  route: string,
  titleKey: string,
  running: boolean,
  progress: UpscaleProgress | null,
): void => {
  const t = useTranslations();
  const { set: setActivity } = useActivity();
  useEffect(() => {
    if (!running) {
      setActivity(id, null);
      return;
    }
    const view = upscaleStatsView(progress, t);
    setActivity(id, {
      id,
      title: t(titleKey),
      route,
      status: "running",
      detail: view.speed ? `${view.label} · ${view.speed}` : view.label,
      percent: view.percent,
    });
  }, [running, progress, setActivity, t, id, route, titleKey]);
};
