# Purpose
Python inference backend for Pixl WebUI: a FastAPI HTTP API that manages model
downloads and runs text-to-image generation with HuggingFace `diffusers`.

# Responsibilities
- Detect the torch device/backend (CUDA / ROCm / CPU)
- Serve the curated model catalog and download models into `models/<slug>`
- Browse/resolve arbitrary HuggingFace diffusers models and add them as custom models
- Assess whether a model fits the current GPU (full / CPU-offload / too large)
- Persist user settings (HuggingFace token)
- Run text-to-image generation as a background job with live step progress
- Optional reference image: img2img variations, or IP-Adapter style (SD 1.5/SDXL)
- Generate a batch of N images per run (sequential, incrementing seeds)
- Stream a live per-step image preview (TAESD tiny decoder) while generating
- Offer selectable samplers (schedulers); swap the pipeline scheduler when the
  loaded model supports it (flow-matching models keep their native sampler)
- Store generated images + metadata in `outputs/` and serve them as a gallery
- Persist reusable positive/negative prompt snippets (prompt templates)
- Delete downloaded models from disk and report live system-resource stats

# File Structure
- pyproject.toml        — package + runtime deps (torch installed separately by install.ps1)
- app/main.py           — FastAPI app, CORS, router registration (controller entry)
- app/config.py         — paths, HF cache redirection, settings store
- app/device.py         — device/backend detection and dtype selection
- app/catalog.py        — curated model catalog (domain data)
- app/samplers.py       — sampler (diffusers scheduler) registry + apply_sampler
- app/messages.py       — centralised English user-facing strings (i18n-ready)
- app/routers/          — HTTP controllers: system, settings, models, generate, images
- app/services/         — business logic: downloader, pipeline, gallery, resources,
                          fit (GPU fit check), custom_models (user-added registry)

# Key Components
- services/downloader.py — background snapshot_download + size-based progress; also
                           HF search (list_models) and repo resolve (size/variant/
                           diffusers-compatibility/VRAM estimate/pipeline_tag) for the
                           browser; search takes a list of pipeline_tags (default
                           text-to-image), one query per tag, merged + deduped
- services/fit.py        — assess(model): fits_gpu / fits_offload / too_large / cpu_only
                           against live VRAM+RAM; drives both the UI badge and the
                           pipeline's device placement (offload) so they never disagree
- services/custom_models.py — persists user-added models in data/custom_models.json;
                           resolve_model(slug) = curated first, then custom
- services/pipeline.py   — diffusers pipeline load/cache + generation (step callback);
                           also builds a cached img2img pipe (from_pipe) and manages
                           IP-Adapter load/unload for style conditioning
- services/gallery.py    — persist images + metadata sidecars in outputs/, list/delete
- services/prompt_templates.py — JSON store for reusable prompt snippets
                           (positive/negative), in data/prompt_templates.json
- services/resources.py  — live CPU/RAM (psutil) + VRAM (torch mem_get_info) stats;
                           GPU compute % is best-effort (needs a vendor SMI, else None)
- services/pipeline.py   — also applies the chosen sampler via samplers.apply_sampler,
                           guarded by pipe.scheduler.compatibles so FLUX/SD3 stay intact;
                           step callback optionally decodes a throttled live preview
- services/preview.py    — TAESD tiny-decoder cache (SD1.5/SDXL) that turns step
                           latents into a small JPEG data URL; best-effort, never
                           blocks generation (other families → no preview)
- app/samplers.py        — curated A1111-style sampler set → diffusers scheduler classes
                           + config flags; apply_sampler(pipe, id) returns the effective id
- routers/generate.py    — generation as a background job; POST starts (returns job_id),
                           GET /api/generate/{job_id} polls step/its/seed progress +
                           batch index and finished image_ids; a run can produce a
                           batch of images (incrementing seeds); GET /api/samplers
                           lists the available samplers + default
- routers/images.py      — GET /api/images, GET /api/images/{id}/file, DELETE /api/images/{id}
- routers/templates.py   — CRUD for prompt snippets under /api/prompt-templates
- routers/models.py      — catalog (curated+custom, each with a fit verdict) +
                           GET /search, GET /resolve, POST /api/models (add by repo_id) +
                           download/progress + DELETE /api/models/{slug} (remove from disk)
- routers/system.py      — GET /api/system (device) + GET /api/system/stats (live resources)

# Dependencies
fastapi, uvicorn, diffusers, transformers, accelerate, huggingface_hub, pillow,
pydantic, psutil; torch (CUDA/ROCm/CPU) installed by the root installer.

# Related Modules
- Parent: ../  (project root)
- Peer: ../frontend (consumes this API)
