// Typed client for the Pixl WebUI backend.

import type {
  AppSettings,
  DownloadProgress,
  GalleryImage,
  GenerateRequest,
  GenerateResponse,
  GenerationProgress,
  HfSearchResult,
  ModelEntry,
  PromptKind,
  PromptSnippet,
  ResolvedModel,
  ResourceStats,
  SamplerList,
  SystemInfo,
} from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

  searchModels: (
    query: string,
    sort: string,
    family = "",
    pipelines: string[] = ["text-to-image"],
    limit = 30,
  ) =>
    request<HfSearchResult[]>(
      `/api/models/search?query=${encodeURIComponent(query)}&sort=${sort}` +
        `&family=${encodeURIComponent(family)}` +
        pipelines.map((p) => `&pipelines=${encodeURIComponent(p)}`).join("") +
        `&limit=${limit}`,
    ),

  resolveModel: (repoId: string) =>
    request<ResolvedModel>(`/api/models/resolve?repo_id=${encodeURIComponent(repoId)}`),

  addModel: (repoId: string) =>
    request<{ slug: string; message: string }>("/api/models", {
      method: "POST",
      body: JSON.stringify({ repo_id: repoId }),
    }),

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

  getImages: () => request<GalleryImage[]>("/api/images"),

  deleteImage: (id: string) =>
    request<{ id: string; status: string }>(`/api/images/${id}`, {
      method: "DELETE",
    }),

  imageFileUrl: (id: string) => `${BASE}/api/images/${id}/file`,
};
