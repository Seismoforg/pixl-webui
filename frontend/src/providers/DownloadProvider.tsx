"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useActivity } from "@/providers/ActivityProvider";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api";
import { live } from "@/lib/ws";
import type { DownloadProgress, UpscalerEngine } from "@/types";

/**
 * App-level download tracking so a download's status survives leaving its page
 * (e.g. navigating off /models mid-download). Callers `track()` a slug after
 * starting the download; the provider follows it over the WebSocket (REST
 * fallback) and mirrors it into the shared activity store so the off-route bubble
 * shows it. Pages read `progress` for their inline bar — one source of truth.
 */
interface TrackMeta {
  title: string; // human name for the bubble
  route: string; // page it belongs to
  fetch: () => Promise<DownloadProgress>; // REST fallback fetcher (per endpoint)
  retry: () => Promise<unknown>; // re-issue the download (e.g. api.downloadModel(slug))
}

interface DownloadContextValue {
  progress: Record<string, DownloadProgress>;
  track: (slug: string, meta: TrackMeta) => void;
}

const DownloadContext = createContext<DownloadContextValue | null>(null);

export const useDownloads = () => {
  const ctx = useContext(DownloadContext);
  if (!ctx) throw new Error("useDownloads must be used within DownloadProvider");
  return ctx;
}

/**
 * Start an upscale/outpaint engine download and register it with the download
 * tracker so its progress survives navigation. Shared by the Models-page engine
 * manager and the upscale panel (they differ only in the `route` the bubble
 * links back to). Rejects if the initial request fails (the caller surfaces it).
 */
export const trackUpscalerDownload = (
  track: DownloadContextValue["track"],
  engine: Pick<UpscalerEngine, "slug" | "name">,
  route: string,
): Promise<void> =>
  api.downloadUpscaler(engine.slug).then(() => {
    track(engine.slug, {
      title: engine.name,
      route,
      fetch: () => api.getUpscalerProgress(engine.slug),
      retry: () => api.downloadUpscaler(engine.slug),
    });
  });

interface DownloadProviderProps {
  onFinished: () => void; // e.g. reload the models list when a download completes
  children: ReactNode;
}

const POLL_MS = 1500;

export const DownloadProvider = ({ onFinished, children }: DownloadProviderProps) => {
  const t = useTranslations();
  const { set } = useActivity();
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [meta, setMeta] = useState<Record<string, TrackMeta>>({});

  const metaRef = useRef(meta);
  metaRef.current = meta;

  const downloadingState = (slug: string): DownloadProgress => ({
    slug,
    status: "downloading",
    downloaded_bytes: 0,
    total_bytes: 0,
    percent: 0,
    error: null,
  });

  const track = useCallback((slug: string, m: TrackMeta) => {
    setMeta((prev) => ({ ...prev, [slug]: m }));
    setProgress((prev) => ({ ...prev, [slug]: downloadingState(slug) }));
  }, []);

  const untrack = useCallback(
    (slug: string) => {
      setMeta((prev) => {
        const next = { ...prev };
        delete next[slug];
        return next;
      });
      set(`download:${slug}`, null);
    },
    [set],
  );

  // Retry a failed download from anywhere (e.g. the off-route bubble). Re-issues
  // the original request; the slug stays tracked so progress keeps flowing.
  const retryDownload = useCallback((slug: string) => {
    const m = metaRef.current[slug];
    if (!m) return;
    setProgress((prev) => ({ ...prev, [slug]: downloadingState(slug) }));
    m.retry().catch(() => {}); // a failure resurfaces via the progress error
  }, []);

  const slugs = Object.keys(meta);

  // Follow each tracked download over the WS (REST fallback while the socket is down).
  useEffect(() => {
    if (slugs.length === 0) return undefined;
    const handle = (u: DownloadProgress) => {
      if (u.status === "idle") return; // transient race before the backend registers
      setProgress((prev) => ({ ...prev, [u.slug]: u }));
      if (u.status === "done") {
        untrack(u.slug); // clears the bubble
        onFinished();
      } else if (u.status === "error") {
        // Keep it tracked so the bubble persists with a Retry action (the mirror
        // effect renders the error state).
        onFinished();
      }
    };
    const unsubs = slugs.map((s) =>
      live.subscribe(`download:${s}`, { channel: "download", slug: s }, (d) =>
        handle(d as DownloadProgress),
      ),
    );
    const id = setInterval(() => {
      if (live.isConnected()) return;
      slugs.forEach((s) => metaRef.current[s]?.fetch().then(handle).catch(() => {}));
    }, POLL_MS);
    return () => {
      unsubs.forEach((u) => u());
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugs.join(","), onFinished, untrack]);

  // Mirror the tracked downloads into the shared activity store (off-route bubble).
  // Failed downloads stay as an error bubble with Retry / Dismiss.
  useEffect(() => {
    for (const slug of slugs) {
      const p = progress[slug];
      const m = meta[slug];
      if (!p || !m) continue;
      const failed = p.status === "error";
      set(`download:${slug}`, {
        id: `download:${slug}`,
        title: t("activity.download", { name: m.title }),
        route: m.route,
        status: failed ? "error" : "running",
        detail: failed
          ? p.error ?? t("activity.downloadFailed")
          : t("activity.downloadPercent", { value: p.percent }),
        percent: failed ? null : p.total_bytes ? p.percent : null,
        onRetry: failed ? () => retryDownload(slug) : undefined,
        onDismiss: failed ? () => untrack(slug) : undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, slugs.join(","), set, t, retryDownload, untrack]);

  return (
    <DownloadContext.Provider value={{ progress, track }}>{children}</DownloadContext.Provider>
  );
}
