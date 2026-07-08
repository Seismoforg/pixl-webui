"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import type { ModelEntry, SystemInfo } from "@/types";

import { ActivityProvider } from "@/providers/ActivityProvider";
import { CompareProvider } from "@/providers/CompareProvider";
import { DownloadProvider } from "@/providers/DownloadProvider";
import { EditProvider } from "@/providers/EditProvider";
import { GenerationProvider } from "@/providers/GenerationProvider";
import { InpaintProvider } from "@/providers/InpaintProvider";
import { ReframeProvider } from "@/providers/ReframeProvider";
import { RestoreProvider } from "@/providers/RestoreProvider";
import { UpscaleProvider } from "@/providers/UpscaleProvider";

/** App-wide data (models + system info) shared across every route. */
interface AppData {
  models: ModelEntry[];
  // True until the first models load resolves (drives the Models list skeleton);
  // later reloads don't flip it back, so there's no skeleton flicker.
  modelsLoading: boolean;
  // Set when a models load fails, so views show an error (not an empty catalog).
  modelsError: boolean;
  system: SystemInfo | null;
  reloadModels: () => void;
  // Bumped whenever the gallery should refetch (e.g. a finished generation).
  // GalleryPanel reads it so it stays fresh without a page reload.
  galleryToken: number;
}

const AppDataContext = createContext<AppData | null>(null);

export const useAppData = () => {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
};

/**
 * Owns the shared models/system state and hosts the always-mounted feature
 * providers (activity, downloads, generation, upscale, reframe). Lives above the
 * routes so long-running jobs and this data survive client-side navigation.
 */
export const AppDataProvider = ({ children }: { children: ReactNode }) => {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState(false);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [galleryToken, setGalleryToken] = useState(0);

  const reloadModels = useCallback(() => {
    api
      .getModels()
      .then((m) => {
        setModels(m);
        setModelsError(false);
      })
      .catch(() => setModelsError(true))
      .finally(() => setModelsLoading(false));
  }, []);

  const refreshGallery = useCallback(() => setGalleryToken((v) => v + 1), []);

  // A finished generation may add a gallery image and can change model state;
  // refresh both so the generate dropdown and gallery reflect it immediately.
  const handleGenerated = useCallback(() => {
    reloadModels();
    refreshGallery();
  }, [reloadModels, refreshGallery]);

  // Load shared data once on mount. Model changes are pushed via reloadModels()
  // from the download/generation/delete handlers, so there is no need to refetch
  // on every navigation — that previously added a backend round-trip (and a
  // re-render flash) to every page switch.
  useEffect(() => {
    reloadModels();
    api
      .getSystem()
      .then(setSystem)
      .catch(() => setSystem(null));
  }, [reloadModels]);

  return (
    <AppDataContext.Provider
      value={{ models, modelsLoading, modelsError, system, reloadModels, galleryToken }}
    >
      <ActivityProvider>
        <DownloadProvider onFinished={reloadModels}>
          <GenerationProvider models={models} onGenerated={handleGenerated}>
            <CompareProvider onCompared={refreshGallery}>
              <UpscaleProvider onUpscaled={refreshGallery}>
                <ReframeProvider onReframed={refreshGallery}>
                  <InpaintProvider onInpainted={refreshGallery}>
                    <EditProvider onEdited={refreshGallery}>
                      <RestoreProvider onRestored={refreshGallery}>{children}</RestoreProvider>
                    </EditProvider>
                  </InpaintProvider>
                </ReframeProvider>
              </UpscaleProvider>
            </CompareProvider>
          </GenerationProvider>
        </DownloadProvider>
      </ActivityProvider>
    </AppDataContext.Provider>
  );
};
