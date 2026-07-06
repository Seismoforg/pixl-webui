"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { UpscalerEngine } from "@/types";

interface UseEngineCatalogResult {
  engines: UpscalerEngine[];
  loading: boolean;
  /** Set when the initial fetch failed — distinct from a genuinely empty catalog. */
  error: string | null;
  reload: () => void;
}

/**
 * Shared upscaler/outpaint/edit-engine catalog fetch for the 4 image-source
 * feature panels (Upscale/Reframe/Inpaint/Edit). Surfaces a fetch failure via
 * `error` instead of silently collapsing to an empty list.
 */
export const useEngineCatalog = (): UseEngineCatalogResult => {
  const [engines, setEngines] = useState<UpscalerEngine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    api
      .getUpscalers()
      .then(setEngines)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { engines, loading, error, reload };
};
