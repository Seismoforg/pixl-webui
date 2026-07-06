// Typed client for the Pixl WebUI backend.

import type {
  AppSettings,
  DownloadProgress,
  EngineCatalogEntry,
  GalleryImage,
  GenerateRequest,
  GenerateResponse,
  GenerationProgress,
  ModelCatalogEntry,
  ModelEntry,
  PromptKind,
  PromptSnippet,
  InpaintProgress,
  InpaintRequest,
  EditProgress,
  EditRequest,
  ResourceStats,
  SamplerList,
  SystemInfo,
  ReframeProgress,
  ReframeRequest,
  UpscalerEngine,
  UpscaleProgress,
  UpscaleRequest,
  UpscaleStarted,
} from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((body) => body?.detail as string | undefined)
      .catch(() => undefined);
    throw new Error(detail ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSystem: () => request<SystemInfo>("/api/system"),

  getSystemStats: () => request<ResourceStats>("/api/system/stats"),

  getModels: () => request<ModelEntry[]>("/api/models"),

  // Curated model-catalog editing (Settings).
  getModelsCatalog: () => request<ModelCatalogEntry[]>("/api/models/catalog"),

  saveModelsCatalog: (entries: ModelCatalogEntry[]) =>
    request<ModelCatalogEntry[]>("/api/models/catalog", {
      method: "PUT",
      body: JSON.stringify(entries),
    }),

  resetModelsCatalog: () =>
    request<ModelCatalogEntry[]>("/api/models/catalog/reset", { method: "POST" }),

  downloadModel: (slug: string) =>
    request<{ slug: string; message: string }>(`/api/models/${slug}/download`, {
      method: "POST",
    }),

  deleteModel: (slug: string) =>
    request<{ slug: string; status: string }>(`/api/models/${slug}`, {
      method: "DELETE",
    }),

  getProgress: (slug: string) =>
    request<DownloadProgress>(`/api/models/${slug}/progress`),

  getSettings: () => request<AppSettings>("/api/settings"),

  saveSettings: (settings: AppSettings) =>
    request<AppSettings>("/api/settings", {
      method: "POST",
      body: JSON.stringify(settings),
    }),

  getSamplers: () => request<SamplerList>("/api/samplers"),

  generate: (req: GenerateRequest) =>
    request<GenerateResponse>("/api/generate", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  getGenerationProgress: (jobId: string) =>
    request<GenerationProgress>(`/api/generate/${jobId}`),

  getPromptSnippets: () => request<PromptSnippet[]>("/api/prompt-templates"),

  createPromptSnippet: (kind: PromptKind, name: string, text: string) =>
    request<PromptSnippet>("/api/prompt-templates", {
      method: "POST",
      body: JSON.stringify({ kind, name, text }),
    }),

  updatePromptSnippet: (id: string, name: string, text: string) =>
    request<PromptSnippet>(`/api/prompt-templates/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, text }),
    }),

  deletePromptSnippet: (id: string) =>
    request<{ id: string; status: string }>(`/api/prompt-templates/${id}`, {
      method: "DELETE",
    }),

  getUpscalers: () => request<UpscalerEngine[]>("/api/upscale/engines"),

  // Curated engine-catalog editing (Settings).
  getEnginesCatalog: () => request<EngineCatalogEntry[]>("/api/upscale/engines/catalog"),

  saveEnginesCatalog: (entries: EngineCatalogEntry[]) =>
    request<EngineCatalogEntry[]>("/api/upscale/engines/catalog", {
      method: "PUT",
      body: JSON.stringify(entries),
    }),

  resetEnginesCatalog: () =>
    request<EngineCatalogEntry[]>("/api/upscale/engines/catalog/reset", { method: "POST" }),

  deleteUpscaler: (slug: string) =>
    request<{ slug: string; status: string }>(`/api/upscale/engines/${slug}`, {
      method: "DELETE",
    }),

  downloadUpscaler: (slug: string) =>
    request<{ slug: string; message: string }>(`/api/upscale/engines/${slug}/download`, {
      method: "POST",
    }),

  getUpscalerProgress: (slug: string) =>
    request<DownloadProgress>(`/api/upscale/engines/${slug}/progress`),

  upscale: (req: UpscaleRequest) =>
    request<UpscaleStarted>("/api/upscale", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  getUpscaleProgress: (jobId: string) =>
    request<UpscaleProgress>(`/api/upscale/${jobId}`),

  reframe: (req: ReframeRequest) =>
    request<UpscaleStarted>("/api/reframe", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  getReframeProgress: (jobId: string) =>
    request<ReframeProgress>(`/api/reframe/${jobId}`),

  inpaint: (req: InpaintRequest) =>
    request<UpscaleStarted>("/api/inpaint", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  getInpaintProgress: (jobId: string) =>
    request<InpaintProgress>(`/api/inpaint/${jobId}`),

  edit: (req: EditRequest) =>
    request<UpscaleStarted>("/api/edit", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  getEditProgress: (jobId: string) =>
    request<EditProgress>(`/api/edit/${jobId}`),

  getImages: () => request<GalleryImage[]>("/api/images"),

  getImage: (id: string) => request<GalleryImage>(`/api/images/${id}`),

  deleteImage: (id: string) =>
    request<{ id: string; status: string }>(`/api/images/${id}`, {
      method: "DELETE",
    }),

  imageFileUrl: (id: string) => `${BASE}/api/images/${id}/file`,
};
