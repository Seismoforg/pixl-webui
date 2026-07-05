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
- Load GGUF-quantized FLUX models (catalog entries carrying a `.gguf` transformer
  source): download the base repo without its transformer weights + the single
  `.gguf`, and load the quantized transformer via diffusers' GGUFQuantizationConfig
  so FLUX runs in ~16 GB VRAM
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
  standalone job/endpoint, separate from upscaling. The inpaint model can be SD/SDXL
  or a GGUF-quantized FLUX.1-Fill-dev engine (Flux-quality outpainting in ~16 GB)
- Serve the curated upscale/outpaint engine catalog (JSON-backed, editable in
  Settings) and download engines like generation models
- Persist reusable positive/negative/upscale/outpaint/outpaint-negative prompt
  snippets (prompt templates)
- Delete downloaded models from disk and report live system-resource stats

# File Structure
- pyproject.toml        — package + runtime deps (torch installed separately by install.ps1)
- app/main.py           — FastAPI app, CORS, router registration (controller entry)
- app/config.py         — paths, HF cache redirection, settings store; also pins the
                          ROCm TunableOp results file into `data/`
- app/device.py         — device/backend detection and dtype selection (fp16 for
                          normal loads; bf16 compute dtype for the GGUF FLUX path)
- app/catalog.py        — curated model catalog (domain data), JSON-backed:
                          `models_catalog.json` ships the default, a git-ignored
                          `data/models_catalog.json` override (written by the Settings
                          editor) replaces it. `ModelInfo` carries optional
                          `gguf_repo_id`/`gguf_filename` (+ `is_gguf`) for
                          GGUF-quantized FLUX entries
- app/models_catalog.json — bundled default generation-model catalog
- app/engines_catalog.json — bundled default upscale/outpaint engine catalog
- app/samplers.py       — sampler (diffusers scheduler) registry + apply_sampler
- app/messages.py       — centralised English user-facing strings (i18n-ready)
- app/live.py           — in-process pub/sub hub: producer threads publish(key) to
                          wake the WebSocket pusher event-driven (thread→async bridge)
- app/routers/          — HTTP controllers: system, settings, models, generate,
                          images, templates, upscale, reframe, ws
- app/services/         — business logic: downloader (download orchestration +
                          progress), pipeline, prompt_embeds (long-prompt CLIP
                          embeds), callbacks (shared diffusers step-callback +
                          timing), gallery (+ data-URL image decode), resources,
                          fit (GPU fit check), upscalers (JSON-backed engine
                          catalog) + upscale (engine service)

# Key Components
- services/downloader.py — background snapshot_download + size-based progress state
                           machine; `resolve_download_files` picks one weight per
                           diffusers component (handles mixed-variant repos);
                           `start_file_download` fetches a single weight (upscaler
                           .pth) reusing the same progress state; delete/is_downloaded.
                           GGUF models take a dedicated path: `resolve_gguf_base_files`
                           = the base repo minus the transformer weights (keeps its
                           config), and `_run_gguf_download` fetches that base snapshot
                           plus the single `.gguf` transformer file into models/<slug>
                           (combined size for progress)
- services/vram.py       — release(): gc + torch.cuda.empty_cache (best-effort). The
                           generation and upscale services free each other's models
                           (and the non-active upscaler engine) + call release before
                           loading, so only the current task's model sits in VRAM;
                           cross-service calls use lazy imports to avoid a cycle
- services/optimizations.py — apply_perf(pipe, settings): best-effort VAE tiling/
                           slicing + xformers, shared by the generation and upscale
                           pipeline loaders; driven by the persisted settings.
                           apply_compile(pipe, settings): optional torch.compile of
                           the denoising module (transformer/unet), Triton-guarded so
                           it's a safe no-op on GPU without Triton (never breaks a load)
- services/upscalers.py  — registry of upscale/outpaint engines (Real-ESRGAN
                           `realesrgan`, SD x4 `sd_x4`, inpaint `inpaint` kinds):
                           slug, repo id/filename, scale, size, min_vram (GPU-fit
                           badge), prompt-capable, variant/use_safetensors,
                           `defaults` (steps/guidance_scale/refine_steps); inpaint
                           engines may carry
                           `gguf_repo_id`/`gguf_filename` (+ `is_gguf`) for a GGUF
                           FLUX.1-Fill-dev outpaint model. JSON-backed like the model
                           catalog: `engines_catalog.json` ships the default, a
                           git-ignored `data/engines_catalog.json` override replaces
                           it; all_engines()/get() read the active catalog
- services/upscale.py    — dispatches upscaling by engine kind: spandrel-loaded
                           Real-ESRGAN or a cached StableDiffusionUpscalePipeline;
                           optional tiling stitches large inputs (bounds VRAM);
                           caches loaded engines like pipeline.py
- services/reframe.py    — aspect-ratio reframing (pure PIL): cover/contain/edge +
                           canvas/mask geometry for outpainting (build_mask gradient
                           band, feathered_keep_mask seam, reflect_fill seed) with
                           default_*_feather/default_seed_blur + scale_softness so the
                           seam widths are user-tunable (0.5 = tuned default);
                           place_offset positions the source (pos_x/pos_y, 0.5 =
                           centred): contain/edge/outpaint place it in the extended
                           canvas, cover pans the kept crop
- services/outpaint.py   — extend an image to a target ratio by generating the new
                           area with a selectable inpaint pipe (engine passed in;
                           reloads on slug change). GGUF engines load FLUX.1-Fill via
                           `_load_flux_fill` (GGUF transformer + FluxFillPipeline +
                           CPU offload); the Flux branch drops the negative prompt,
                           passes explicit height/width, and uses a 1024 cap. Non-GGUF
                           engines use AutoPipelineForInpainting as before. Whole-canvas
                           composition pass at a model-family working cap (SD 1.x 768 /
                           SDXL 1024 / FLUX 1024) — the full
                           canvas directly when it fits, else generated at the cap and
                           upscaled, then (only when the `refine` flag is set, off by
                           default) a short low-strength hires refinement pass
                           re-adds full-res border detail. The pristine full-res source
                           is composited back over its region (feathered seam) so the
                           source stays pixel-exact and only the border is AI; VRAM-
                           coordinated. The mask/seam/seed widths are user-scalable via
                           mask_softness/seam_softness/seed_softness (0..1, 0.5 =
                           default) and the source placement via pos_x/pos_y (0.5 =
                           centred). The negative prompt = the configurable
                           Settings.outpaint_negative default with the per-run negative
                           appended. Generation params are configurable per run:
                           steps (composition) + refine_steps (hires pass) + guidance +
                           an optional sampler (applied via samplers.apply_sampler when
                           the pipe supports it) + a seed (seeded torch.Generator for a
                           reproducible border). Used by the reframe job for
                           reframe=outpaint
- services/fit.py        — assess(model): fits_gpu / fits_offload / too_large / cpu_only
                           against live VRAM+RAM; drives both the UI badge and the
                           pipeline's device placement (offload) so they never disagree
- services/pipeline.py   — diffusers pipeline load/cache + generation (step callback);
                           also builds a cached img2img pipe (from_pipe) and manages
                           IP-Adapter load/unload for style conditioning. GGUF entries
                           branch to `_load_gguf`: the transformer is built from the
                           local `.gguf` (GGUFQuantizationConfig, bf16) and passed into
                           FluxPipeline.from_pretrained (overriding that component),
                           then CPU-offloaded to bound VRAM (FLUX only). On ROCm the
                           load prologue enables TunableOp (GEMM tuning); after
                           apply_perf it runs apply_compile (optional torch.compile)
- services/callbacks.py  — shared diffusers step-callback wiring (`step_kwargs`,
                           modern/legacy API) + `StepTimer` (iterations/second
                           from the first step); used by pipeline/upscale/outpaint
- services/gallery.py    — persist images + metadata sidecars in outputs/, list/
                           delete; `decode_data_url` turns a base64 data URL into a
                           PIL image (shared by the generate/upscale routers)
- services/prompt_templates.py — JSON store for reusable prompt snippets
                           (positive/negative/upscale/outpaint/outpaint_negative),
                           in data/prompt_templates.json
- services/resources.py  — live CPU/RAM (psutil) + VRAM (torch mem_get_info) stats;
                           GPU compute % is best-effort: NVIDIA via
                           torch.cuda.utilization(), else the gpu_win Windows
                           fallback; None only when neither is available
- services/gpu_win.py    — vendor-agnostic Windows GPU% fallback: a long-lived
                           PowerShell process streams the busiest \GPU Engine(*)
                           utilisation perf counter (same source as Task Manager),
                           cached by a reader thread so the endpoint never blocks.
                           Works on AMD/ROCm where no NVML/amdsmi exists; degrades
                           to None off-Windows or when counters are absent. Used by
                           resources.py
- services/pipeline.py   — also applies the chosen sampler via samplers.apply_sampler,
                           guarded by pipe.scheduler.compatibles so FLUX/SD3 stay intact;
                           step callback optionally decodes a throttled live preview
- services/preview.py    — TAESD tiny-decoder cache (SD1.5/SDXL) that turns step
                           latents into a small JPEG data URL; best-effort, never
                           blocks generation (other families → no preview)
- services/prompt_embeds.py — builds CLIP prompt_embeds via compel for SD 1.5 /
                           SDXL so prompts beyond 77 tokens aren't truncated and
                           A1111 weighting works; pos/neg padded to equal length
                           (compel's SDXL padding is broken). best-effort: returns
                           None (→ plain prompt) if compel is missing or encoding
                           fails. Called by pipeline.generate
- app/samplers.py        — curated A1111-style sampler set → diffusers scheduler classes
                           + config flags; apply_sampler(pipe, id) returns the effective id
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
                           engine); upscales and saves to the gallery. Reframing is
                           now a separate router (below)
- routers/reframe.py     — POST /api/reframe (gallery-id or uploaded data URL +
                           target_ratio + reframe strategy + outpaint_prompt +
                           outpaint_negative + outpaint_engine + outpaint seam-blend
                           softness mask/seam/seed_softness + source position
                           pos_x/pos_y + outpaint generation params
                           outpaint_steps/refine_steps/guidance/sampler/seed/batch +
                           an outpaint_refine flag gating the slow full-res hires
                           refinement pass, off by default)
                           as a background job that reframes the
                           image to a target aspect ratio WITHOUT upscaling
                           (cover/contain/edge = pure PIL; outpaint = the outpaint
                           service, generating `outpaint_batch` variants with
                           incrementing seeds) and saves to the gallery;
                           GET /api/reframe/{job_id} returns `ReframeProgress` (the
                           upscale `UpscaleProgress` shape + batch_index/batch_size/
                           image_ids; phase incl. "outpainting"/steps/elapsed).
                           Mirrors the upscale job store; publishes the `reframe`
                           WS channel
- routers/templates.py   — CRUD for prompt snippets under /api/prompt-templates
- routers/models.py      — catalog list (curated, each with a fit verdict) +
                           catalog editing (GET/PUT /api/models/catalog,
                           POST /api/models/catalog/reset) + download/progress +
                           DELETE /api/models/{slug} (remove from disk)
- routers/system.py      — GET /api/system (device) + GET /api/system/stats (live resources)
- routers/ws.py          — multiplexed WebSocket at /ws: subscribe channels
                           (system/generation/upscale/reframe/download), server pushes the
                           same models the REST endpoints return, send-on-change;
                           generation/upscale/reframe (and download status) are event-driven
                           via app/live.py publish; system stats + download bytes stay
                           on a ~1s tick (sampled). REST endpoints remain the fallback

# Dependencies
fastapi, uvicorn, diffusers (>=0.31 for GGUF), transformers, accelerate,
huggingface_hub, pillow, pydantic, psutil, compel (long/weighted prompts), gguf
(GGUF-quantized FLUX transformers); torch (CUDA/ROCm/CPU) installed by the root
installer.

# Related Modules
- Parent: ../  (project root)
- Peer: ../frontend (consumes this API)
