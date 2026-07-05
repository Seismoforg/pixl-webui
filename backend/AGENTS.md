# Purpose
Python inference backend for Pixl WebUI: a FastAPI HTTP API that manages model
downloads and runs text-to-image generation with HuggingFace `diffusers`.

# Responsibilities
- Detect the torch device/backend (CUDA / ROCm / CPU)
- Serve the curated model catalog and download models into `models/<slug>`
- Browse/resolve arbitrary HuggingFace diffusers models and add them as custom models
- Assess whether a model fits the current GPU (full / CPU-offload / too large)
- Persist user settings (HuggingFace token + performance toggles: VAE tiling/
  slicing, xformers — applied to generation and upscale pipelines on load; plus
  the SD x4 upscaler step count, read per-run)
- Run text-to-image generation as a background job with live step progress
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
  standalone job/endpoint, separate from upscaling
- Browse/add custom upscale & outpaint engines (custom Real-ESRGAN weight, SD x4
  or inpaint diffusers repo), managed like generation models (curated + custom)
- Persist reusable positive/negative/upscale prompt snippets (prompt templates)
- Delete downloaded models from disk and report live system-resource stats

# File Structure
- pyproject.toml        — package + runtime deps (torch installed separately by install.ps1)
- app/main.py           — FastAPI app, CORS, router registration (controller entry)
- app/config.py         — paths, HF cache redirection, settings store
- app/device.py         — device/backend detection and dtype selection
- app/catalog.py        — curated model catalog (domain data)
- app/samplers.py       — sampler (diffusers scheduler) registry + apply_sampler
- app/messages.py       — centralised English user-facing strings (i18n-ready)
- app/live.py           — in-process pub/sub hub: producer threads publish(key) to
                          wake the WebSocket pusher event-driven (thread→async bridge)
- app/routers/          — HTTP controllers: system, settings, models, generate,
                          images, templates, upscale, reframe, ws
- app/services/         — business logic: downloader (download orchestration +
                          progress), hf_browse (HF search + repo/engine resolve),
                          pipeline, prompt_embeds (long-prompt CLIP embeds),
                          callbacks (shared diffusers step-callback + timing),
                          gallery (+ data-URL image decode), resources, fit (GPU
                          fit check), custom_models (user-added registry),
                          upscalers (engine registry) + upscale (engine service)

# Key Components
- services/downloader.py — background snapshot_download + size-based progress state
                           machine; `resolve_download_files` picks one weight per
                           diffusers component (handles mixed-variant repos);
                           `start_file_download` fetches a single weight (upscaler
                           .pth) reusing the same progress state; delete/is_downloaded
- services/hf_browse.py  — HuggingFace browsing (split out of downloader): HF search
                           (list_models) and repo resolve (size/variant/diffusers-
                           compatibility/VRAM estimate/pipeline_tag) for the browser;
                           search takes a list of pipeline_tags (default text-to-image),
                           one query per tag, merged + deduped; `resolve_engine`
                           inspects a custom upscale/outpaint engine repo. Imports
                           `resolve_download_files` from downloader (one-way)
- services/vram.py       — release(): gc + torch.cuda.empty_cache (best-effort). The
                           generation and upscale services free each other's models
                           (and the non-active upscaler engine) + call release before
                           loading, so only the current task's model sits in VRAM;
                           cross-service calls use lazy imports to avoid a cycle
- services/optimizations.py — apply_perf(pipe, settings): best-effort VAE tiling/
                           slicing + xformers, shared by the generation and upscale
                           pipeline loaders; driven by the persisted settings
- services/upscalers.py  — registry of upscale/outpaint engines (Real-ESRGAN
                           `realesrgan`, SD x4 `sd_x4`, inpaint `inpaint` kinds):
                           slug, repo id/filename, scale, size, prompt-capable,
                           variant/use_safetensors; all_engines() = curated + custom
                           (get()/is_curated() resolve both, lazy custom import)
- services/custom_upscalers.py — persists user-added engines in
                           data/custom_upscalers.json (mirrors custom_models.py)
- services/upscale.py    — dispatches upscaling by engine kind: spandrel-loaded
                           Real-ESRGAN or a cached StableDiffusionUpscalePipeline;
                           optional tiling stitches large inputs (bounds VRAM);
                           caches loaded engines like pipeline.py
- services/reframe.py    — aspect-ratio reframing (pure PIL): cover/contain/edge +
                           canvas/mask geometry for outpainting
- services/outpaint.py   — extend an image to a target ratio by generating the new
                           area with a selectable SD inpaint pipe (engine passed in;
                           reloads on slug change); whole-canvas composition pass at a
                           model-family working cap (SD 1.x 768 / SDXL 1024) — the full
                           canvas directly when it fits, else generated at the cap and
                           upscaled, then a short low-strength hires refinement pass
                           re-adds full-res border detail. The pristine full-res source
                           is composited back over its region (feathered seam) so the
                           source stays pixel-exact and only the border is AI; VRAM-
                           coordinated. Used by the reframe job for reframe=outpaint
- services/fit.py        — assess(model): fits_gpu / fits_offload / too_large / cpu_only
                           against live VRAM+RAM; drives both the UI badge and the
                           pipeline's device placement (offload) so they never disagree
- services/custom_models.py — persists user-added models in data/custom_models.json;
                           resolve_model(slug) = curated first, then custom
- services/pipeline.py   — diffusers pipeline load/cache + generation (step callback);
                           also builds a cached img2img pipe (from_pipe) and manages
                           IP-Adapter load/unload for style conditioning
- services/callbacks.py  — shared diffusers step-callback wiring (`step_kwargs`,
                           modern/legacy API) + `StepTimer` (iterations/second
                           from the first step); used by pipeline/upscale/outpaint
- services/gallery.py    — persist images + metadata sidecars in outputs/, list/
                           delete; `decode_data_url` turns a base64 data URL into a
                           PIL image (shared by the generate/upscale routers)
- services/prompt_templates.py — JSON store for reusable prompt snippets
                           (positive/negative/upscale), in data/prompt_templates.json
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
- routers/upscale.py     — GET /api/upscale/engines (curated+custom, +per-engine
                           download/progress); add/resolve/delete custom engines
                           (GET /engines/resolve, POST /engines, DELETE /engines/{slug});
                           POST /api/upscale (engine + gallery-id or uploaded data URL
                           + upscaler prompt + tile flag + per-run sd_x4_steps
                           override) as a background job,
                           GET /api/upscale/{job_id} (phase/tiles/steps/elapsed/
                           engine); upscales and saves to the gallery. Reframing is
                           now a separate router (below)
- routers/reframe.py     — POST /api/reframe (gallery-id or uploaded data URL +
                           target_ratio + reframe strategy + outpaint_prompt +
                           outpaint_engine) as a background job that reframes the
                           image to a target aspect ratio WITHOUT upscaling
                           (cover/contain/edge = pure PIL; outpaint = the outpaint
                           service) and saves to the gallery; GET /api/reframe/{job_id}
                           reuses the upscale `UpscaleProgress` shape (phase incl.
                           "outpainting"/steps/elapsed). Mirrors the upscale job
                           store; publishes the `reframe` WS channel
- routers/templates.py   — CRUD for prompt snippets under /api/prompt-templates
- routers/models.py      — catalog (curated+custom, each with a fit verdict) +
                           GET /search, GET /resolve, POST /api/models (add by repo_id) +
                           download/progress + DELETE /api/models/{slug} (remove from disk)
- routers/system.py      — GET /api/system (device) + GET /api/system/stats (live resources)
- routers/ws.py          — multiplexed WebSocket at /ws: subscribe channels
                           (system/generation/upscale/reframe/download), server pushes the
                           same models the REST endpoints return, send-on-change;
                           generation/upscale/reframe (and download status) are event-driven
                           via app/live.py publish; system stats + download bytes stay
                           on a ~1s tick (sampled). REST endpoints remain the fallback

# Dependencies
fastapi, uvicorn, diffusers, transformers, accelerate, huggingface_hub, pillow,
pydantic, psutil, compel (long/weighted prompts); torch (CUDA/ROCm/CPU) installed
by the root installer.

# Related Modules
- Parent: ../  (project root)
- Peer: ../frontend (consumes this API)
