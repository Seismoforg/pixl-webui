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

// The editable catalog shape for a generation model (mirrors backend ModelInfo).
export interface ModelCatalogEntry {
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
  use_safetensors: boolean;
  // GGUF-quantized variant: the transformer's source (FLUX only). Present only for
  // quantized catalog entries; drives the "GGUF" tag in the model list.
  gguf_repo_id: string | null;
  gguf_filename: string | null;
  defaults: GenerationDefaults;
}

// A catalog model plus its on-disk state + GPU-fit verdict (the /api/models list).
export interface ModelEntry extends ModelCatalogEntry {
  downloaded: boolean;
  status: DownloadStatus;
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
  vae_tiling: boolean;
  vae_slicing: boolean;
  xformers: boolean;
  torch_compile: boolean;
  sd_x4_steps: number;
  outpaint_negative: string; // built-in negative base for AI outpainting
  // Preferred default dropdown selections (slugs); used only when downloaded, else
  // the UI falls back to the first downloaded entry of that kind.
  default_model: string | null;
  default_upscaler: string | null;
  default_outpaint_engine: string | null;
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

export type PromptKind = "positive" | "negative" | "upscale" | "outpaint" | "outpaint_negative";

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

/** The editable catalog shape for a LoRA (mirrors backend LoraInfo). */
export interface LoraCatalogEntry {
  slug: string;
  repo_id: string;
  filename: string;
  name: string;
  family: string; // "SD 1.5" | "SDXL" | "FLUX" — must match the base model
  description: string;
  trigger: string | null;
  approx_size_gb: number;
}

/** A catalog LoRA plus its on-disk state (the /api/loras list). */
export interface LoraEntry extends LoraCatalogEntry {
  downloaded: boolean;
  status: DownloadStatus;
}

/** A LoRA selected for a generation run: its slug and blend weight. */
export interface LoraRef {
  slug: string;
  weight: number;
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
  loras: LoraRef[]; // LoRA adapters to blend into the run
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

export type UpscalerKind = "realesrgan" | "sd_x4" | "inpaint" | "edit";

export type ReframeStrategy = "cover" | "contain" | "edge" | "outpaint";

export interface EngineDefaults {
  steps: number; // denoising / composition steps
  guidance_scale: number; // CFG scale (0 for prompt-free / GAN engines)
  refine_steps: number; // hires refinement pass steps (outpaint); 0 when unused
}

// The editable catalog shape for an engine (mirrors backend UpscalerInfo).
export interface EngineCatalogEntry {
  slug: string;
  kind: UpscalerKind;
  name: string;
  description: string;
  repo_id: string;
  filename: string | null; // single weight file for realesrgan; null for diffusers
  scale: number;
  approx_size_gb: number;
  min_vram_gb: number; // recommended VRAM — drives the GPU-fit badge
  prompt_capable: boolean;
  variant: string | null;
  use_safetensors: boolean;
  gguf_repo_id: string | null; // GGUF FLUX Fill outpaint transformer source
  gguf_filename: string | null;
  defaults: EngineDefaults;
}

export interface UpscalerEngine {
  slug: string;
  kind: UpscalerKind;
  name: string;
  description: string;
  repo_id: string;
  family: string; // "Upscaler" | "Outpaint" (derived from kind)
  scale: number;
  approx_size_gb: number;
  min_vram_gb: number; // recommended VRAM — drives the per-row VRAM badge
  prompt_capable: boolean;
  is_gguf: boolean; // GGUF-quantized FLUX Fill outpaint engine (flow-matching)
  downloaded: boolean;
  status: DownloadStatus;
  fit: FitInfo; // GPU-fit verdict, like the model catalog entries
}

export interface UpscaleRequest {
  engine: string;
  image_id?: string | null;
  image_data?: string | null; // uploaded image as a data URL
  prompt: string; // guides the diffusion upscaler (SD x4) toward detail
  tile: boolean; // auto-split large images into tiles and stitch
  sd_x4_steps?: number | null; // per-run SD x4 steps; null → the persisted setting
}

export interface UpscaleStarted {
  job_id: string;
}

/** Chosen source image: an existing gallery image, or an uploaded data URL. */
export type UpscaleSource =
  | { kind: "gallery"; imageId: string; preview: string }
  | { kind: "upload"; dataUrl: string };

/** Reframe (aspect-ratio change, no upscaling) request. */
export interface ReframeRequest {
  image_id?: string | null;
  image_data?: string | null; // uploaded image as a data URL
  target_ratio: string; // "16:9" | "4:3" | … (never "original"); "WxH" for custom
  // Custom exact output resolution (pixels). Both set → resize the result to exactly
  // this size (may upscale); omitted → size derived from the source + ratio.
  target_width?: number | null;
  target_height?: number | null;
  reframe: ReframeStrategy;
  outpaint_prompt: string; // describes the scene generated in the outpainted area
  outpaint_negative?: string; // per-run negative, appended to the Settings default
  outpaint_engine?: string | null; // inpaint engine slug; null → curated default
  // Seam-blend tuning for reframe=outpaint (0..1; 0.5 = tuned default): mask
  // gradient band / composite-back seam fade / reflected-seed blur.
  mask_softness?: number;
  seam_softness?: number;
  seed_softness?: number;
  // Source placement in the extended canvas (0..1; 0.5 = centred). Area-adding
  // strategies (outpaint/contain/edge); cover ignores it.
  pos_x?: number;
  pos_y?: number;
  // Source scale within the frame (0..1; 1 = fills the fitting axis). < 1 shrinks the
  // source inside a larger canvas to position it (area-adding strategies; cover ignores).
  scale?: number;
  // Generation parameters for reframe=outpaint (ignored by cover/contain/edge):
  // composition/refinement steps, CFG scale, scheduler id, seed (null → random),
  // and how many variants to generate (incrementing seeds).
  outpaint_steps?: number;
  outpaint_refine_steps?: number;
  outpaint_refine?: boolean; // run the slow full-res hires refine pass (default off)
  outpaint_guidance?: number;
  outpaint_sampler?: string | null;
  outpaint_seed?: number | null;
  outpaint_batch?: number;
}

/** The upscale progress shape plus batch fields (a superset, so the shared
 *  upscale live-stats UI keeps working). Shared by Reframe/Inpaint/Edit, whose
 *  jobs all produce a batch of result images. */
export interface BatchProgress extends UpscaleProgress {
  batch_index: number;
  batch_size: number;
  image_ids: string[];
}

/** Reframe job progress = the batch progress shape. */
export interface ReframeProgress extends BatchProgress {}

/** Inpaint (paint-a-mask region fill) request. */
export interface InpaintRequest {
  image_id?: string | null;
  image_data?: string | null; // uploaded source image as a data URL
  mask_data: string; // painted mask as a data URL (white = repaint, black = keep)
  engine?: string | null; // inpaint engine slug; null → curated default
  prompt: string; // what to draw inside the painted area
  negative?: string; // per-run negative, appended to the Settings default
  // Feather tuning (0..1; 0.5 = default): mask-edge gradient / composite seam /
  // seed blur under the mask.
  mask_softness?: number;
  seam_softness?: number;
  seed_softness?: number;
  mask_expand?: number; // grow the painted region before generating (0..1)
  // Generation parameters: inpaint/refine steps, CFG scale, scheduler id, seed
  // (null → random), and how many variants to generate (incrementing seeds).
  steps?: number;
  refine_steps?: number;
  refine?: boolean; // run the slow full-res hires refine pass (default off)
  guidance?: number;
  sampler?: string | null;
  seed?: number | null;
  batch?: number;
}

/** Inpaint job progress = the batch progress shape. */
export interface InpaintProgress extends BatchProgress {}

/** A generation parameter that an XYZ-plot axis can sweep. */
export type CompareParam = "steps" | "guidance_scale" | "sampler" | "seed";

/** One compare axis: a swept parameter and its list of values (numbers for
 *  steps/guidance/seed, sampler ids for sampler). */
export interface CompareAxis {
  param: CompareParam;
  values: Array<number | string>;
}

/** XYZ-plot compare request: base generation params + 1–3 sweep axes. */
export interface CompareRequest {
  slug: string;
  prompt: string;
  negative_prompt?: string | null;
  width: number;
  height: number;
  // Base values for the parameters not being swept.
  steps: number;
  guidance_scale: number;
  seed?: number | null;
  sampler: string;
  axes: CompareAxis[]; // X = columns, Y = rows, Z = one sheet per value
}

/** Compare job progress = the batch progress shape (cell index = batch index,
 *  total cells = batch size; each finished sheet is a result image). */
export interface CompareProgress extends BatchProgress {}

/** Post-Processing (FLUX Kontext) prompt-based image-edit request. */
export interface EditRequest {
  image_id?: string | null;
  image_data?: string | null; // uploaded source image as a data URL
  engine?: string | null; // edit engine slug; null → curated default
  prompt: string; // the natural-language edit instruction
  // Generation parameters: denoising steps, CFG scale, seed (null → random), and
  // how many variants to generate (incrementing seeds).
  steps?: number;
  guidance?: number;
  seed?: number | null;
  batch?: number;
}

/** Edit job progress = the batch progress shape. */
export interface EditProgress extends BatchProgress {}

export type UpscalePhase =
  | "loading"
  | "upscaling"
  | "outpainting"
  | "inpainting"
  | "editing"
  | "comparing"
  | "finalizing";

export interface UpscaleProgress {
  job_id: string;
  status: GenerationStatus; // "running" | "done" | "error"
  phase: UpscalePhase;
  current_tile: number;
  total_tiles: number;
  current_step: number; // diffusion step within the current tile (SD x4); 0 for Real-ESRGAN
  total_steps: number;
  its: number | null; // iterations/second (SD x4 steps); null until measurable
  elapsed: number; // seconds since the job started
  engine_name: string;
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
  loras?: string[]; // applied LoRAs as "slug@weight"; absent on pre-LoRA images
}
