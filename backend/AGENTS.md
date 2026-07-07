# Purpose
Python inference backend for Pixl WebUI: a FastAPI HTTP API that manages model
downloads and runs text-to-image generation with HuggingFace `diffusers`.

# Responsibilities
- Detect the torch device/backend (CUDA / ROCm / CPU)
- Serve the curated model catalog (JSON-backed, editable in Settings) and download
  models into `models/<slug>`
- Assess whether a model fits the current GPU (full / CPU-offload / too large)
- Persist user settings (HuggingFace token + performance toggles: VAE tiling/
  slicing, xformers, torch.compile — applied to generation and upscale pipelines on
  load; plus the SD x4 upscaler step count and the outpaint negative-prompt default,
  read per-run; plus preferred default dropdown selections
  `default_model`/`default_upscaler`/`default_outpaint_engine`, consumed by the UI).
  On ROCm, GEMM kernels are auto-tuned via TunableOp (persistently cached in `data/`)
- Run text-to-image generation as a background job with live step progress
- Load GGUF-quantized FLUX and SD 3.x models (catalog entries carrying a `.gguf`
  transformer source): download the base repo without its transformer weights + the
  single `.gguf`, and load the quantized transformer via diffusers'
  GGUFQuantizationConfig so FLUX / SD 3.5 Large run in ~16 GB VRAM
- Encode long/weighted prompts (>77 CLIP tokens, A1111 `(word:1.2)` weighting)
  via compel for SD 1.5 / SDXL; other families keep the native prompt path
- Optional reference image: img2img variations, or IP-Adapter style (SD 1.5/SDXL)
- Generate a batch of N images per run (sequential, incrementing seeds)
- Stream a live per-step image preview (TAESD tiny decoder) while generating
- Offer selectable samplers (schedulers); swap the pipeline scheduler when the
  loaded model supports it (flow-matching models keep their native sampler)
- Store generated images + metadata in `outputs/` and serve them as a gallery
- Upscale an image (from the gallery or an upload) with a selectable AI upscaler
  (Real-ESRGAN via spandrel, or the SD x4 diffusion upscaler), downloading the
  engine on demand and optionally tiling large inputs
- Reframe an image to a target aspect ratio WITHOUT upscaling (cover/contain/edge,
  or AI outpaint with a selectable inpaint model + its own outpaint prompt) — a
  standalone job/endpoint, separate from upscaling. A "custom" target instead pins an
  exact output resolution (target_width×target_height): the strategy sets the aspect,
  then the result is resized to those exact pixels (may upscale — the one exception to
  the no-upscaling rule). The inpaint model can be SD/SDXL
  or a GGUF-quantized FLUX.1-Fill-dev engine (Flux-quality outpainting in ~16 GB)
- Inpaint a hand-painted region of an image (user supplies the mask; white =
  repaint) with a selectable inpaint engine + a prompt — a standalone job/endpoint.
  Auto-crops a padded box around the mask, generates at the model's native
  resolution, and composites the result back over the pixel-exact source with a
  feathered seam. Reuses the same `inpaint`-kind engines as outpaint (SD/SDXL +
  GGUF FLUX.1-Fill); a curated SDXL inpaint checkpoint (`inpaint--sdxl`) covers the
  mid-VRAM tier
- Post-process (edit) an image from a natural-language instruction ("change the
  lighting to a night scene") with FLUX.1 Kontext — a whole-image, mask-free,
  structure-preserving edit. A separate `edit`-kind engine loaded from a
  GGUF-quantized Kontext transformer (like the FLUX Fill engines, ~16 GB); its own
  job/endpoint, VRAM-coordinated with the other model services
- Serve the curated upscale/outpaint/inpaint engine catalog (JSON-backed, editable
  in Settings) and download engines like generation models
- Persist reusable positive/negative/upscale/outpaint/outpaint-negative prompt
  snippets (prompt templates)
- Delete downloaded models from disk and report live system-resource stats

# File Structure
- pyproject.toml        — package + runtime deps (torch installed separately by install.ps1)
- app/main.py           — FastAPI app, CORS, router registration (controller entry)
- app/config.py         — paths, HF cache redirection, settings store; also pins the
                          ROCm TunableOp results file into `data/`
- app/device.py         — device/backend detection + dtype selection (fp16 normal;
                          bf16 compute dtype for GGUF FLUX). Shared pipe helpers:
                          `place_offloaded` (CPU-offload placement), `make_generator`
                          (seeded torch.Generator), `load_gguf_pipe` (GGUF transformer +
                          pipe + offload, used by generate/inpaint/edit GGUF loads)
- app/catalog.py        — curated model catalog (domain data), JSON-backed:
                          `models_catalog.json` ships the default, a git-ignored
                          `data/models_catalog.json` override (written by the Settings
                          editor) replaces it. `ModelInfo` carries optional
                          `gguf_repo_id`/`gguf_filename` (+ `is_gguf`) for
                          GGUF-quantized FLUX / SD 3.x entries
- app/models_catalog.json — bundled default generation-model catalog
- app/engines_catalog.json — bundled default upscale/outpaint engine catalog
- app/samplers.py       — sampler (diffusers scheduler) registry + apply_sampler
- app/messages.py       — centralised English user-facing strings (i18n-ready)
- app/live.py           — in-process pub/sub hub: producer threads publish(key) to
                          wake the WebSocket pusher event-driven (thread→async bridge)
- app/routers/          — HTTP controllers: system, settings, models, loras, generate,
                          compare, images, templates, upscale, reframe, inpaint, edit, ws
- app/services/         — business-logic layer (inference, VRAM, downloads, gallery,
                          shared job infra). One module per concern; see
                          app/services/AGENTS.md for the full list + per-service detail

# Key Components
- services/* — business logic; per-service detail in app/services/AGENTS.md. Modules:
               jobs (shared job store/resolve/save), job_guard (ADR 0014), downloader,
               pipeline, prompt_embeds, preview, callbacks, upscalers, upscale, reframe,
               inpaint_engine, inpaint, outpaint, edit, fit, gallery, prompt_templates,
               resources, gpu_win, vram, optimizations
- app/samplers.py        — curated A1111-style sampler set → diffusers scheduler classes
                           + config flags; apply_sampler(pipe, id) returns the effective id
- routers/loras.py       — LoRA adapter catalog + downloads: GET /api/loras (each with
                           downloaded flag), catalog GET/PUT/reset, POST /{slug}/download
                           (single .safetensors via downloader.start_file_download) +
                           GET /{slug}/progress + DELETE /{slug}. LoRAs are applied at
                           generation time (see pipeline + generate), not a job of their own
- routers/compare.py     — XYZ-plot compare as a background job: POST /api/compare
                           (base generate params + `axes` = 1–3 `{param, values}` sweeps
                           over a whitelist steps/guidance_scale/sampler/seed; X=cols,
                           Y=rows, Z=one sheet per value; capped at MAX_CELLS=64) loops
                           pipeline.generate over the cartesian product (one model load)
                           and composes labelled grid sheet(s) via services.grid, saved to
                           the gallery; GET /api/compare/{job_id} returns the shared
                           `BatchProgress` (cell index = batch index). Publishes the
                           `compare` WS channel
- routers/generate.py    — generation as a background job; POST starts (returns job_id),
                           GET /api/generate/{job_id} polls step/its/seed progress +
                           batch index and finished image_ids; a run can produce a
                           batch of images (incrementing seeds); GET /api/samplers
                           lists the available samplers + default
- routers/images.py      — GET /api/images, GET /api/images/{id} (metadata),
                           GET /api/images/{id}/file, DELETE /api/images/{id}
- routers/upscale.py     — GET /api/upscale/engines (curated list + per-engine
                           download/progress + GPU-fit verdict); engine-catalog editing
                           (GET/PUT /engines/catalog, POST /engines/catalog/reset);
                           DELETE /engines/{slug} (remove from disk);
                           POST /api/upscale (engine + gallery-id or uploaded data URL
                           + upscaler prompt + tile flag + per-run sd_x4_steps
                           override) as a background job,
                           GET /api/upscale/{job_id} (phase/tiles/steps/elapsed/
                           engine); upscales and saves to the gallery. Also defines the
                           shared `UpscaleProgress`/`BatchProgress` models (reused by
                           reframe/inpaint/edit). Reframing is now a separate router
- routers/reframe.py     — background job: reframe to a target aspect ratio WITHOUT
                           upscaling, saved to the gallery. POST /api/reframe body:
                           gallery-id or data URL, target_ratio (+ optional
                           target_width/target_height for exact resolution), strategy,
                           outpaint_prompt/outpaint_negative/outpaint_engine, outpaint
                           seam-blend softness mask/seam/seed_softness, source position
                           pos_x/pos_y, source scale (shrinks source in frame;
                           area-adding strategies), outpaint gen params
                           outpaint_steps/refine_steps/guidance/sampler/seed/batch,
                           outpaint_refine flag (gates the slow full-res hires pass, off
                           by default). cover/contain/edge = pure PIL; outpaint = the
                           outpaint service (`outpaint_batch` variants, incrementing
                           seeds). GET /api/reframe/{job_id} → `BatchProgress` (the
                           `UpscaleProgress` shape + batch_index/batch_size/image_ids;
                           phase incl. "outpainting"/steps/elapsed). Shared services.jobs
                           store; `reframe` WS channel
- routers/inpaint.py     — POST /api/inpaint (gallery-id or uploaded data URL +
                           mask_data painted-mask data URL + engine + prompt +
                           negative + feather softness mask/seam/seed_softness +
                           generation params steps/refine_steps/refine/guidance/
                           sampler/seed/batch) as a background job that repaints the
                           masked region via the inpaint service (generating `batch`
                           variants with incrementing seeds) and saves to the gallery;
                           GET /api/inpaint/{job_id} returns `BatchProgress`
                           (UpscaleProgress + batch fields; phase incl. "inpainting").
                           Uses the shared services.jobs store; publishes the `inpaint`
                           WS channel
- routers/edit.py        — POST /api/edit (gallery-id or uploaded data URL + edit
                           engine + instruction prompt + generation params
                           steps/guidance/seed/batch) as a background job that edits
                           the image via the edit service (generating `batch` variants
                           with incrementing seeds) and saves to the gallery;
                           GET /api/edit/{job_id} returns `BatchProgress`
                           (UpscaleProgress + batch fields; phase incl. "editing").
                           Requires a non-empty prompt and an `edit`-kind engine. Uses
                           the shared services.jobs store; publishes the `edit` WS channel
- routers/templates.py   — CRUD for prompt snippets under /api/prompt-templates
- routers/models.py      — catalog list (curated, each with a fit verdict) +
                           catalog editing (GET/PUT /api/models/catalog,
                           POST /api/models/catalog/reset) + download/progress +
                           DELETE /api/models/{slug} (remove from disk)
- routers/system.py      — GET /api/system (device) + GET /api/system/stats (live resources)
- routers/ws.py          — multiplexed WebSocket at /ws: subscribe channels
                           (system/generation/compare/upscale/reframe/inpaint/edit/download), server pushes the
                           same models the REST endpoints return, send-on-change;
                           generation/compare/upscale/reframe/inpaint/edit (and download status) are event-driven
                           via app/live.py publish; system stats + download bytes stay
                           on a ~1s tick (sampled). REST endpoints remain the fallback

# Dependencies
fastapi, uvicorn, diffusers (>=0.31 for GGUF), transformers, accelerate,
huggingface_hub, pillow, pydantic, psutil, compel (long/weighted prompts), gguf
(GGUF-quantized FLUX / SD 3.x transformers), peft (PEFT backend for LoRA
load/blend); torch (CUDA/ROCm/CPU) installed by the root installer.

# Related Modules
- Parent: ../  (project root)
- Peer: ../frontend (consumes this API)
- Child: ./app/services (business logic)
