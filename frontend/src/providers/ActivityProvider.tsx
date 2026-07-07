"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * A single generic "activity" any long-running backend task publishes. The
 * ActivityOverlay renders a bubble for each running activity whose `route` isn't
 * the current page — so generation, upscaling, downloads (and anything future)
 * share one off-route status mechanism. Sources call `set(id, activity)` to
 * publish/update and `set(id, null)` to clear.
 */
export interface Activity {
  id: string; // unique, e.g. "generation", "upscale", "download:<slug>"
  title: string; // bubble heading
  route: string; // the page it belongs to; the bubble hides there and taps navigate to it
  status: "running" | "done" | "error";
  detail?: string; // one-line progress text
  percent?: number | null; // determinate bar value, or null for indeterminate
  onRetry?: () => void; // shown as a Retry button (e.g. failed download)
  onDismiss?: () => void; // shown as a dismiss action (e.g. give up on a failed task)
}

interface ActivityContextValue {
  activities: Activity[];
  set: (id: string, activity: Activity | null) => void;
}

const ActivityContext = createContext<ActivityContextValue | null>(null);

export const useActivity = () => {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error("useActivity must be used within ActivityProvider");
  return ctx;
};

export const ActivityProvider = ({ children }: { children: ReactNode }) => {
  const [map, setMap] = useState<Record<string, Activity>>({});

  const set = useCallback((id: string, activity: Activity | null) => {
    setMap((prev) => {
      if (activity === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      const cur = prev[id];
      // Skip a state update when nothing the bubble renders has changed.
      if (
        cur &&
        cur.title === activity.title &&
        cur.detail === activity.detail &&
        cur.percent === activity.percent &&
        cur.status === activity.status &&
        cur.route === activity.route
      ) {
        return prev;
      }
      return { ...prev, [id]: activity };
    });
  }, []);

  const activities = useMemo(() => Object.values(map), [map]);

  return (
    <ActivityContext.Provider value={{ activities, set }}>{children}</ActivityContext.Provider>
  );
};
