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
- app/device.py         — device/backend detection and dtype selection (fp16 for
                          normal loads; bf16 compute dtype for the GGUF FLUX path)
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
- app/routers/          — HTTP controllers: system, settings, models, generate,
                          images, templates, upscale, reframe, inpaint, edit, ws
- app/services/         — business logic: downloader (download orchestration +
                          progress), pipeline, prompt_embeds (long-prompt CLIP
                          embeds), callbacks (shared diffusers step-callback +
                          timing), gallery (+ data-URL image decode), resources,
                          fit (GPU fit check), upscalers (JSON-backed engine
                          catalog) + upscale (engine service); inpaint_engine
                          (shared inpaint pipe load/run) + inpaint (user-mask) +
                          outpaint (border-mask) services; edit (FLUX Kontext
                          prompt-based whole-image edit)

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
                           to_exact_size (final resize to a custom target W×H) +
                           canvas/mask geometry for outpainting (build_mask gradient
                           band, feathered_keep_mask seam, reflect_fill seed) with
                           default_*_feather/default_seed_blur + scale_softness so the
                           seam widths are user-tunable (0.5 = tuned default);
                           place_offset positions the source (pos_x/pos_y, 0.5 =
                           centred): contain/edge/outpaint place it in the extended
                           canvas, cover pans the kept crop. extend_size takes a
                           `scale` (0..1, 1 = fills the frame): < 1 enlarges the canvas
                           by 1/scale so the source sits smaller inside it with room to
                           be positioned on both axes (contain/edge/outpaint; cover
                           ignores it)
- services/inpaint_engine.py — shared inpaint-engine primitives used by BOTH the
                           outpaint and inpaint services: the single cached inpaint
                           pipe + `load`/`unload`, `run_inpaint` (one inpaint pass,
                           step-reported), engine-family caps, `is_sdxl`/`is_flux`/
                           `working_cap`, `make_generator`, `effective_negative`.
                           GGUF engines load FLUX.1-Fill via `_load_flux_fill` (GGUF
                           transformer + FluxFillPipeline + CPU offload; the Flux
                           branch drops the negative prompt and passes explicit
                           height/width); non-GGUF engines use
                           AutoPipelineForInpainting. Only one inpaint pipe is loaded
                           at a time (outpaint + inpaint never run together);
                           `pipeline.unload()`/`upscale.unload()` are called before
                           loading (VRAM-coordinated)
- services/inpaint.py    — user-mask inpainting: repaint the painted region (white in
                           the mask) with an `inpaint`-kind engine. Auto-crops a
                           padded box around the mask (`_padded_box`; a `mask_expand`
                           knob first grows the painted region so the edit swallows a
                           subject's soft fringe instead of leaving a halo of the
                           original), scales that
                           crop into the model's working range (UP to the family native
                           res so small edits don't fall below the training size →
                           noise; DOWN to the cap for huge crops), generates there, and
                           composites the result back over the pixel-exact full-res
                           source with a feathered seam. Three feather knobs mirror reframe
                           (mask_softness = mask-edge gradient fed to the diffuser,
                           seed_softness = blur of the source under the mask,
                           seam_softness = composite-back alpha), plus optional hires
                           refine on large crops. FLUX Fill is fed a CRISP binary mask +
                           unblurred init (it zeroes the masked init and reads the mask
                           in latent space, so a soft edge leaves a grey haze ring); the
                           composite seam does the blend there. SD/SDXL keep the
                           feathered mask + seed blur. Uses `inpaint_engine` + reframe
                           geometry helpers. Driven by the inpaint job
- services/outpaint.py   — extend an image to a target ratio by generating the new
                           area with a selectable inpaint pipe (engine + pass
                           load/run via `inpaint_engine`; `unload` re-exported from
                           it). Whole-canvas
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
- services/edit.py       — prompt-based whole-image editing (FLUX.1 Kontext). Loads an
                           `edit`-kind engine's GGUF transformer into a
                           `FluxKontextPipeline` (own cached pipe + `unload`,
                           CPU-offloaded). `edit_image` runs one Kontext pass (source
                           image + instruction prompt, NO mask, NO negative — Kontext
                           auto-resizes to its preferred ~1 MP internally, bounding
                           VRAM, and the result is scaled back to the source size),
                           step-reported (phase "editing"). VRAM-coordinated: loading
                           frees the generation/upscale/inpaint models, and each of
                           those frees it before loading (mutual lazy-import unload).
                           Driven by the edit job
- services/fit.py        — assess(model): fits_gpu / fits_offload / too_large / cpu_only
                           against live VRAM+RAM; drives both the UI badge and the
                           pipeline's device placement (offload) so they never disagree
- services/pipeline.py   — diffusers pipeline load/cache + generation (step callback);
                           also builds a cached img2img pipe (from_pipe) and manages
                           IP-Adapter load/unload for style conditioning. GGUF entries
                           branch to `_load_gguf`: the transformer is built from the
                           local `.gguf` (GGUFQuantizationConfig, bf16) and passed into
                           the family's pipeline.from_pretrained (Flux/StableDiffusion3,
                           overriding that component), then CPU-offloaded to bound VRAM
                           (FLUX + SD 3.x). On ROCm the
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
                           target_ratio (+ optional target_width/target_height for a
                           custom exact resolution) + reframe strategy + outpaint_prompt +
                           outpaint_negative + outpaint_engine + outpaint seam-blend
                           softness mask/seam/seed_softness + source position
                           pos_x/pos_y + source scale (shrinks the source within the
                           frame; area-adding strategies) + outpaint generation params
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
- routers/inpaint.py     — POST /api/inpaint (gallery-id or uploaded data URL +
                           mask_data painted-mask data URL + engine + prompt +
                           negative + feather softness mask/seam/seed_softness +
                           generation params steps/refine_steps/refine/guidance/
                           sampler/seed/batch) as a background job that repaints the
                           masked region via the inpaint service (generating `batch`
                           variants with incrementing seeds) and saves to the gallery;
                           GET /api/inpaint/{job_id} returns `InpaintProgress` (the
                           `ReframeProgress` shape: UpscaleProgress + batch fields;
                           phase incl. "inpainting"). Mirrors the reframe job store;
                           publishes the `inpaint` WS channel
- routers/edit.py        — POST /api/edit (gallery-id or uploaded data URL + edit
                           engine + instruction prompt + generation params
                           steps/guidance/seed/batch) as a background job that edits
                           the image via the edit service (generating `batch` variants
                           with incrementing seeds) and saves to the gallery;
                           GET /api/edit/{job_id} returns `EditProgress` (the
                           `InpaintProgress` shape: UpscaleProgress + batch fields;
                           phase incl. "editing"). Requires a non-empty prompt and an
                           `edit`-kind engine. Mirrors the inpaint job store; publishes
                           the `edit` WS channel
- routers/templates.py   — CRUD for prompt snippets under /api/prompt-templates
- routers/models.py      — catalog list (curated, each with a fit verdict) +
                           catalog editing (GET/PUT /api/models/catalog,
                           POST /api/models/catalog/reset) + download/progress +
                           DELETE /api/models/{slug} (remove from disk)
- routers/system.py      — GET /api/system (device) + GET /api/system/stats (live resources)
- routers/ws.py          — multiplexed WebSocket at /ws: subscribe channels
                           (system/generation/upscale/reframe/inpaint/edit/download), server pushes the
                           same models the REST endpoints return, send-on-change;
                           generation/upscale/reframe/inpaint/edit (and download status) are event-driven
                           via app/live.py publish; system stats + download bytes stay
                           on a ~1s tick (sampled). REST endpoints remain the fallback

# Dependencies
fastapi, uvicorn, diffusers (>=0.31 for GGUF), transformers, accelerate,
huggingface_hub, pillow, pydantic, psutil, compel (long/weighted prompts), gguf
(GGUF-quantized FLUX / SD 3.x transformers); torch (CUDA/ROCm/CPU) installed by the root
installer.

# Related Modules
- Parent: ../  (project root)
- Peer: ../frontend (consumes this API)
