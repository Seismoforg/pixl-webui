"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface AsyncData<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Runs `fetcher` on mount and whenever `deps` change, exposing a uniform
 * `{ data, loading, error, reload }` lifecycle so every mount-driven fetch handles
 * loading/error identically instead of ad-hoc useState + useEffect + `.catch`.
 * `loading` is true during the first load and any explicit `reload()`. Results
 * from a superseded request (deps change / unmount) are ignored, so the last
 * request wins and no state is set after unmount.
 */
export const useAsyncData = <T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): AsyncData<T> => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  // Hold the latest fetcher without making it a dep (callers pass inline fns).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    fetcherRef.current()
      .then((result) => {
        if (id !== reqId.current) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (id !== reqId.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    run();
    // Invalidate any in-flight request on deps change / unmount.
    return () => {
      reqId.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: run };
};
