// Types mirroring the backend API responses.

export interface DeviceInfo {
  torch_available: boolean;
  backend: "cuda" | "rocm" | "cpu" | "none";
  device: "cuda" | "cpu";
  gpu_name: string | null;
  torch_version: string | null;
}

export interface SystemInfo {
  device: DeviceInfo;
  models_dir: string;
}

export interface GenerationDefaults {
  steps: number;
  guidance_scale: number;
  width: number;
  height: number;
}

export type DownloadStatus = "idle" | "downloading" | "done" | "error";

export type FitVerdict = "fits_gpu" | "fits_offload" | "too_large" | "cpu_only";

export interface FitInfo {
  verdict: FitVerdict;
  est_vram_gb: number;
  gpu_total_gb: number | null;
  ram_total_gb: number | null;
}

export interface ModelEntry {
  slug: string;
  repo_id: string;
  name: string;
  family: string;
  pipeline_tag: string;
  description: string;
  gated: boolean;
  approx_size_gb: number;
  min_vram_gb: number;
  defaults: GenerationDefaults;
  downloaded: boolean;
  status: DownloadStatus;
  curated: boolean;
  fit: FitInfo;
}

export interface HfSearchResult {
  repo_id: string;
  likes: number;
  downloads: number;
  gated: boolean;
  family: string;
  pipeline_tag: string | null;
  last_modified: string | null;
}

export interface ResolvedModel {
  slug: string;
  repo_id: string;
  name: string;
  family: string;
  pipeline_tag: string;
  description: string;
  gated: boolean;
  approx_size_gb: number;
  min_vram_gb: number;
  variant: string | null;
  defaults: GenerationDefaults;
  compatible: boolean;
  fit: FitInfo;
}

export interface DownloadProgress {
  slug: string;
  status: DownloadStatus;
  downloaded_bytes: number;
  total_bytes: number;
  percent: number;
  error: string | null;
}

export interface AppSettings {
  hf_token: string | null;
}

export interface ResourceStats {
  cpu_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
  vram_used_gb: number | null;
  vram_total_gb: number | null;
  vram_percent: number | null;
  gpu_percent: number | null;
}

export type PromptKind = "positive" | "negative";

export interface PromptSnippet {
  id: string;
  kind: PromptKind;
  name: string;
  text: string;
}

export interface Sampler {
  id: string;
  label: string;
}

export interface SamplerList {
  samplers: Sampler[];
  default: string;
}

export interface GenerateRequest {
  slug: string;
  prompt: string;
  negative_prompt?: string | null;
  steps: number;
  guidance_scale: number;
  width: number;
  height: number;
  seed?: number | null;
  sampler: string;
  preview: boolean;
  batch: number;
  reference_image?: string | null; // data URL
  reference_mode: ReferenceMode;
  strength: number;
  ip_adapter_scale: number;
}

export type ReferenceMode = "img2img" | "style";

export interface GenerateResponse {
  job_id: string;
}

export type GenerationStatus = "running" | "done" | "error";

export type GenerationPhase = "loading" | "generating" | "finalizing";

export interface GenerationProgress {
  job_id: string;
  status: GenerationStatus;
  phase: GenerationPhase;
  current_step: number;
  total_steps: number;
  its: number | null; // iterations per second
  seed: number; // base seed; image k of the batch uses seed + k
  prompt: string;
  batch_size: number;
  batch_index: number; // 1-based index of the image currently generating
  image_ids: string[]; // finished batch images, in order
  preview: string | null; // data URL of the latest in-progress frame
  image_id: string | null;
  error: string | null;
}

export interface GalleryImage {
  id: string;
  created: string;
  model_slug: string;
  model_name: string;
  prompt: string;
  negative_prompt: string | null;
  steps: number;
  guidance_scale: number;
  width: number;
  height: number;
  seed: number;
  sampler: string;
}
