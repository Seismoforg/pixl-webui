# Purpose
Business-logic layer for the Pixl WebUI backend: model/engine loading, inference
(generate/upscale/reframe/inpaint/outpaint/edit), VRAM coordination, downloads,
gallery persistence, and shared job infra. Controllers in `../routers` dispatch here.

# Responsibilities
- Load + cache diffusers pipelines (incl. GGUF-quantized FLUX / SD 3.x) and run inference
- Coordinate VRAM: one heavy model resident at a time (mutual unload-on-load)
- Orchestrate model/engine downloads with size-based progress
- Persist images + metadata to `outputs/`; decode uploaded data URLs
- Provide shared background-job infra (store, source resolve, progress, save)
- Assess GPU fit; report live CPU/RAM/VRAM/GPU% stats

# File Structure
- jobs.py           — shared job infra (see Key Components)
- job_guard.py      — process-wide single-heavy-job guard (see ADR 0014)
- downloader.py     — download orchestration + progress state machine
- pipeline.py       — diffusers load/cache + text-to-image generation (+ LoRA blend)
- loras.py          — LoRA adapter catalog (JSON-backed, family-scoped)
- prompt_embeds.py  — long/weighted CLIP prompt embeds (compel)
- preview.py        — TAESD live per-step preview
- callbacks.py      — shared diffusers step-callback + StepTimer
- samplers is `../samplers.py` (app-level), not here
- upscalers.py      — upscale/outpaint/inpaint engine catalog (JSON-backed)
- upscale.py        — upscaling dispatch (Real-ESRGAN / SD x4) + tiling
- reframe.py        — aspect-ratio reframe geometry (pure PIL)
- grid.py           — compose a labelled XYZ-plot contact-sheet grid (pure PIL)
- inpaint_engine.py — shared inpaint pipe load/run (outpaint + inpaint)
- inpaint.py        — user-mask inpainting
- outpaint.py       — border-mask outpainting (reframe=outpaint)
- edit.py           — FLUX.1 Kontext whole-image prompt edit
- fit.py            — GPU-fit assessment
- gallery.py        — image + metadata persistence; data-URL decode
- prompt_templates.py — reusable prompt-snippet JSON store
- resources.py      — live CPU/RAM/VRAM/GPU% stats
- gpu_win.py        — Windows GPU% fallback (PowerShell perf counter)
- vram.py           — release(): gc + empty_cache

# Key Components
- jobs.py — shared background-job infra for the image-op routers: `JobState`
            (batch-capable progress record + elapsed()), `JobStore[J]` (per-router
            in-memory store + id counter + the lock guarding job mutations),
            `resolve_source(req, missing_msg)` (gallery id OR data URL → PIL; raises
            SOURCE_DECODE_FAILED on bad decode), `make_on_progress` (setattr-loop +
            live.publish callback), `save_result` (gallery.save + record image_id/
            image_ids). generate keeps its own richer `_Job` but reuses `JobStore`
- job_guard.py — process-wide single-heavy-job guard: acquire(job_id, kind)/
            release(job_id). Every job router acquires on start (409 JOB_BUSY when any
            job runs) + releases in `_run` finally. See ADR 0014
- downloader.py — background snapshot_download + size-based progress. `resolve_download_files`
            picks one weight per diffusers component (mixed-variant repos);
            `start_file_download` fetches a single weight (upscaler .pth) reusing the
            progress state; delete/is_downloaded. GGUF path: `resolve_gguf_base_files`
            = base repo minus transformer (keeps config), `_run_gguf_download` fetches
            base snapshot + the single `.gguf` into models/<slug> (combined size)
- loras.py — LoRA catalog (JSON-backed like models/engines): `LoraInfo` (slug, repo_id,
            filename, family, trigger?, size), `all_loras()`/`get()` + catalog load/save/
            reset. Each downloads its single `.safetensors` into models/<slug> via the
            downloader single-file path; applied at generation time by pipeline
- pipeline.py — diffusers load/cache + generation (step callback); cached img2img pipe
            (from_pipe) + IP-Adapter load/unload for style. LoRA: `_apply_loras` loads +
            `set_adapters` blends the requested `(slug, weight)` list on the base pipe
            (family-matched, downloaded, non-GGUF; idempotent when unchanged),
            `_ensure_no_loras` clears them; reset on model switch. GGUF entries → `_load_gguf`:
            transformer built from local `.gguf` (GGUFQuantizationConfig, bf16), passed
            into family from_pretrained (Flux/StableDiffusion3), CPU-offloaded (bounds
            VRAM). ROCm: load prologue enables TunableOp (GEMM tuning); post apply_perf
            runs apply_compile. Also applies the sampler via samplers.apply_sampler,
            guarded by pipe.scheduler.compatibles (FLUX/SD3 kept intact); step callback
            optionally decodes a throttled live preview
- prompt_embeds.py — CLIP prompt_embeds via compel (SD 1.5/SDXL) so >77-token prompts
            aren't truncated + A1111 weighting works; pos/neg padded equal (compel SDXL
            padding is broken). best-effort → None (plain prompt) on missing/failed.
            Called by pipeline.generate
- preview.py — TAESD tiny-decoder cache (SD1.5/SDXL): step latents → small JPEG data
            URL; best-effort, never blocks generation (other families → no preview)
- callbacks.py — shared diffusers step-callback wiring (`step_kwargs`, modern/legacy
            API) + `StepTimer` (its/s from first step); used by pipeline/upscale/outpaint
- upscalers.py — registry of upscale/outpaint engines (`realesrgan`, `sd_x4`, `inpaint`
            kinds): slug, repo id/filename, scale, size, min_vram, prompt-capable,
            variant/use_safetensors, `defaults` (steps/guidance_scale/refine_steps);
            inpaint engines may carry `gguf_repo_id`/`gguf_filename` (+ `is_gguf`) for a
            GGUF FLUX.1-Fill-dev model. JSON-backed: `engines_catalog.json` default, a
            git-ignored `data/engines_catalog.json` override; all_engines()/get()
- upscale.py — upscaling by engine kind: spandrel Real-ESRGAN or cached
            StableDiffusionUpscalePipeline; optional tiling stitches large inputs
            (bounds VRAM); caches loaded engines like pipeline.py
- reframe.py — aspect-ratio reframe (pure PIL): cover/contain/edge + to_exact_size
            (custom W×H final resize) + canvas/mask geometry for outpaint (build_mask
            gradient band, feathered_keep_mask seam, reflect_fill seed) with
            default_*_feather/default_seed_blur + scale_softness (user-tunable, 0.5 =
            default); place_offset positions the source (pos_x/pos_y, 0.5 = centred);
            extend_size `scale` (0..1, 1 = fills frame): <1 enlarges canvas by 1/scale
            so the source sits smaller with room to position (contain/edge/outpaint;
            cover ignores it)
- inpaint_engine.py — shared inpaint primitives for BOTH outpaint + inpaint: single
            cached inpaint pipe + `load`/`unload`, `run_inpaint` (one step-reported
            pass), engine caps, `is_sdxl`/`is_flux`/`working_cap`, `make_generator`,
            `effective_negative`. GGUF → `_load_flux_fill` (GGUF transformer +
            FluxFillPipeline + CPU offload; Flux drops negative, passes explicit
            height/width); non-GGUF → AutoPipelineForInpainting. Only one inpaint pipe
            loaded at a time; `pipeline.unload()`/`upscale.unload()` before load
            (VRAM-coordinated)
- inpaint.py — user-mask inpainting: repaint the white-masked region with an `inpaint`
            engine. `_padded_box` crops a padded box (a `mask_expand` knob first grows
            the region to swallow a subject's soft fringe → no halo), scales the crop
            into the model working range (UP to family native res so small edits don't
            fall below training size → noise; DOWN to cap for huge crops), generates,
            composites back over the pixel-exact full-res source (feathered seam). Three
            feather knobs mirror reframe (mask_softness = mask-edge gradient to diffuser,
            seed_softness = source blur under mask, seam_softness = composite alpha) +
            optional hires refine on large crops. FLUX Fill: CRISP binary mask +
            unblurred init (zeroes masked init, reads mask in latent space; soft edge →
            grey haze ring) — composite seam blends; SD/SDXL keep feathered mask + seed
            blur. Uses inpaint_engine + reframe geometry. Driven by the inpaint job
- outpaint.py — extend to a target ratio by generating the new area with a selectable
            inpaint pipe (load/run via inpaint_engine; `unload` re-exported). Whole-canvas
            composition at a family cap (SD 1.x 768 / SDXL 1024 / FLUX 1024) — full canvas
            when it fits, else generated at cap + upscaled, then (only if `refine`, off
            by default) a short low-strength hires pass re-adds full-res border. Pristine
            source composited back (feathered seam) → source pixel-exact, only border AI;
            VRAM-coordinated. mask/seam/seed widths user-scalable (0..1, 0.5 = default),
            placement via pos_x/pos_y (0.5 = centred). FLUX-aware (like inpaint): FLUX
            Fill gets CRISP binary border mask + UNBLURRED init → mask_softness/
            seed_softness inert, only seam_softness applies; SD/SDXL keep feathered mask
            + seed blur. Negative = Settings.outpaint_negative default + per-run negative.
            Per-run params: steps (composition) + refine_steps (hires) + guidance +
            optional sampler (samplers.apply_sampler when supported) + seed (seeded
            torch.Generator). Used by reframe=outpaint
- edit.py — prompt-based whole-image editing (FLUX.1 Kontext). Loads an `edit` engine's
            GGUF transformer into a `FluxKontextPipeline` (own cached pipe + `unload`,
            CPU-offloaded). `edit_image` = one Kontext pass (source + instruction, NO
            mask, NO negative — auto-resizes to ~1 MP internally bounding VRAM, result
            scaled back to source size), step-reported (phase "editing"). VRAM-
            coordinated: loading frees generation/upscale/inpaint, each frees it before
            load (mutual lazy-import unload). Driven by the edit job
- fit.py — assess(model): fits_gpu / fits_offload / too_large / cpu_only vs live
            VRAM+RAM; drives both the UI badge and pipeline device placement (offload)
            so they never disagree
- gallery.py — persist images + metadata sidecars in outputs/, list/delete;
            `decode_data_url` turns a base64 data URL into a PIL image (shared via jobs)
- prompt_templates.py — JSON store for reusable prompt snippets (positive/negative/
            upscale/outpaint/outpaint_negative) in data/prompt_templates.json
- resources.py — live CPU/RAM (psutil) + VRAM (torch mem_get_info) stats; GPU compute %
            best-effort: NVIDIA torch.cuda.utilization(), else gpu_win fallback; None only
            when neither available
- gpu_win.py — vendor-agnostic Windows GPU% fallback: a long-lived PowerShell process
            streams the busiest `\GPU Engine(*)` util perf counter (Task Manager source),
            cached by a reader thread so the endpoint never blocks. Works on AMD/ROCm
            (no NVML/amdsmi); None off-Windows or when counters absent. Used by resources
- vram.py — release(): gc + torch.cuda.empty_cache (best-effort). Generation + upscale
            free each other's models (+ the non-active upscaler engine) + release before
            load, so only the current task's model sits in VRAM; cross-service calls use
            lazy imports to avoid a cycle

# Dependencies
diffusers (>=0.31 for GGUF), transformers, accelerate, huggingface_hub, pillow,
pydantic, psutil, compel, gguf, spandrel (Real-ESRGAN); torch (CUDA/ROCm/CPU).

# Related Modules
- Parent: ../../ (backend)
- Peer: ../routers (controllers that dispatch here)
