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
- model_slots.py    — model-slot registry: services register their unload; acquire(name)
                      frees every other slot + vram.release (see ADR 0023)
- downloader.py     — download orchestration + progress state machine
- pipeline.py       — diffusers load/cache + text-to-image generation (+ LoRA blend)
- loras.py          — LoRA adapter catalog (JSON-backed, family-scoped)
- prompt_embeds.py  — long/weighted CLIP prompt embeds (compel)
- preview.py        — TAESD live per-step preview
- callbacks.py      — shared diffusers step-callback + StepTimer + `gpu_sync` (syncs the
                      GPU in the step callback so it/s + phase timing are accurate)
- samplers is `../samplers.py` (app-level), not here
- upscalers.py      — upscale/outpaint/inpaint engine catalog (JSON-backed)
- upscale.py        — upscaling dispatch (Real-ESRGAN / SD x4) + tiling + CodeFormer
                      `face_restore` (identity-preserving face restoration)
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
- optimizations.py  — perf toggles applied on pipe load: apply_perf (VAE tiling/
                      slicing, attention slicing [enable/disable per setting — the single
                      place all pipes get it; no VRAM auto-switch], xformers),
                      apply_compile (torch.compile)
- vram.py           — release(): gc + empty_cache

# Key Components
- jobs.py — shared job kernel for ALL six job routers: `SEED_MAX` (32-bit seed cap),
            `UpscaleProgress`/`BatchProgress` response schemas + `to_upscale_progress`/
            `to_batch_progress` builders (snapshot a JobState under the store lock),
            `JobState` (batch-capable progress record + elapsed(); generate subclasses it
            for seed/prompt/preview), `JobStore[J]` (per-router in-memory store + id
            counter + the lock guarding job mutations), `start_job` (create record +
            job_guard.acquire [raises `JobBusy` → 409 via the main.py handler] + store.add
            + daemon-thread spawn), `job_run` (context manager: done/error tail + optional
            unload + guard release), `run_batch` (incrementing-seed batch loop:
            batch_index/start_image per round, `render(i, seed_i)`, finalizing publish,
            save_result), `resolve_source(req, missing_msg)` (gallery id OR data URL →
            PIL; raises SOURCE_DECODE_FAILED on bad decode), `make_on_progress`
            (setattr-loop + live.publish dict callback for the services),
            `make_on_step` (int step-callback adapter for pipeline.generate — clamp,
            first_step_at, stored `its`, optional finalizing tail; generate finalize=True,
            compare finalize=False), `resolve_sampler` (record NATIVE for flow-matching
            engines), `save_result` (gallery.save + record image_id/image_ids;
            `record_timing=False` for compare's sheets)
- job_guard.py — process-wide single-heavy-job guard: acquire(job_id, kind)/
            release(job_id). Every job router acquires on start (409 JOB_BUSY when any
            job runs) + releases in `_run` finally. See ADR 0014
- downloader.py — background snapshot_download + size-based progress. `resolve_download_files`
            picks one weight per diffusers component (mixed-variant repos);
            `start_file_download` fetches a single weight (upscaler .pth) reusing the
            progress state; delete/is_downloaded. GGUF path: `resolve_gguf_base_files`
            = base repo minus transformer (keeps config), `_run_gguf_download` fetches
            base snapshot + the single `.gguf` into models/<slug> (combined size).
            Civitai path: `start_civitai_download` streams one civitai.com version file
            (`/api/download/models/{id}`, auth via the `civitai_token` setting; 401/403 →
            CIVITAI_AUTH_REQUIRED) into models/<slug> — for LoRAs not on HuggingFace
- loras.py — LoRA catalog (JSON-backed like models/engines) + `apply_lora_set(pipe,
            family, is_gguf, requested, loaded, load_one?)` — the shared validate/
            blend/clear core used by generation (with its kohya-resilient load_one)
            and edit (plain load): `LoraInfo` (slug, repo_id
            [empty for Civitai], filename, family [incl. "FLUX.2"], kind
            [style|character|concept|realism|accelerator|other, default "other"; UI
            badge], `civitai_version_id`?, trigger?, size), `all_loras()`/`get()` +
            catalog load/save/reset. Each downloads its single `.safetensors` into
            models/<slug> via the downloader (HF single-file, or Civitai when
            `civitai_version_id` is set); applied at generation by pipeline + in the edit
            service. NOTE: FLUX.2 LoRAs are 4B/9B-size-specific but share family "FLUX.2"
            (a wrong-size pick errors at load — see technical-debt)
- pipeline.py — diffusers load/cache + generation (step callback); cached img2img pipe
            (from_pipe) + IP-Adapter load/unload for style. LoRA: `_apply_loras` =
            the shared `loras.apply_lora_set`
            (family-matched, downloaded, non-GGUF; idempotent when unchanged) with
            `_load_one_lora` (falls back to a UNet-only load when a kohya LoRA's
            text-encoder weights trip this diffusers version's rank parser),
            `_ensure_no_loras` clears them; reset on model switch. GGUF entries → `_load_gguf`:
            transformer built from local `.gguf` (GGUFQuantizationConfig, bf16), passed
            into family from_pretrained (Flux/StableDiffusion3), CPU-offloaded (bounds
            VRAM). Non-GGUF at NF4/int8 (`effective_level` != fp16) → `_load_quantized`:
            heavy module (transformer/UNet by family) bitsandbytes-quantized from local
            fp16 weights via `device.load_quantized_pipe`, CPU-offloaded — LoRA-capable
            (unlike GGUF). Family "Z-Image" → `ZImagePipeline` in bf16 (not bnb-quantized;
            `quantize.quantizable` excludes it), placed by the fit verdict (resident when
            it fits, else CPU offload); text2img only for now (reference-image ignored).
            Family "FLUX.2" → `_load_flux2` → `device.load_flux2_pipe` (`Flux2KleinPipeline`,
            DUAL-module NF4: transformer + 8B Qwen3 text encoder via
            `quantize.flux2_quant_config`), placed by the fit verdict; text2img only in v1
            (reference-image ignored), inline decode.
            ROCm: load prologue enables TunableOp (GEMM tuning) per the
            `tunable_ops` setting, after `_prune_stale_tunable_cache` drops a cache whose
            validators (rocBLAS/hipBLASLt version) no longer match the runtime; post apply_perf
            runs apply_compile. Also applies the sampler via samplers.apply_sampler,
            guarded by pipe.scheduler.compatibles (FLUX/SD3 kept intact); step callback
            optionally decodes a throttled live preview. FLUX decodes via
            `output_type="latent"` + `decode_flux_latents` (manual unpack/scale +
            vae.decode; shared with inpaint_engine + edit) so the pipeline offloads
            the transformer through its own hook
            FIRST — the inline VAE decode is pathologically slow under CPU offload on
            some GPUs (resident quantized transformer starves it of VRAM → ~8-45s);
            decoding after the offload frees the GPU → ~2s at full quality
- prompt_embeds.py — CLIP prompt_embeds via compel (SD 1.5/SDXL) so >77-token prompts
            aren't truncated + A1111 weighting works; pos/neg padded equal (compel SDXL
            padding is broken). best-effort → None (plain prompt) on missing/failed.
            Called by pipeline.generate
- preview.py — TAESD tiny-decoder cache (SD1.5/SDXL): step latents → small JPEG data
            URL; best-effort, never blocks generation (other families → no preview)
- callbacks.py — shared diffusers step-callback wiring (`step_kwargs`, modern/legacy
            API) + `StepTimer` (its/s from first step); used by pipeline/upscale/outpaint
- upscalers.py — registry of upscale/outpaint engines (`realesrgan`, `sd_x4`,
            `face_restore`, `inpaint` kinds): slug, repo id/filename, scale, size,
            min_vram, prompt-capable, variant/use_safetensors, `defaults`
            (steps/guidance_scale/refine_steps); inpaint engines may carry
            `gguf_repo_id`/`gguf_filename` (+ `is_gguf`) for a GGUF FLUX.1-Fill-dev
            model. JSON-backed: `engines_catalog.json` default, a git-ignored
            `data/engines_catalog.json` override; all_engines()/get()
- upscale.py — upscaling by engine kind: spandrel Real-ESRGAN or cached
            StableDiffusionUpscalePipeline; optional tiling stitches large inputs
            (bounds VRAM); caches loaded engines like pipeline.py. `face_restore` →
            `_restore_faces`: CodeFormer (spandrel + spandrel_extra_arches, single .pth
            like Real-ESRGAN) restores each face facexlib detects/aligns, pasted back at
            a `fidelity` weight (identity↔smoothness); no-face image passes through.
            Face DETECTION runs on CPU (ROCm/gfx1201 MIOpen batch-norm crash on GPU),
            CodeFormer restore on GPU. facexlib det/parse weights auto-download to
            `models/facexlib` on first use (see ADR 0022 + technical-debt)
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
            `effective_negative`. GGUF → `_load_flux_fill_gguf` (GGUF transformer +
            FluxFillPipeline + CPU offload; Flux drops negative, passes explicit
            height/width); non-GGUF FLUX Fill → `_load_flux_fill` (fp16 transformer
            NF4/int8-quantized per effective level, else fp16; CPU offload); Z-Image
            (engine_family "Z-Image") → `_load_zimage_inpaint` (ZImageInpaintPipeline
            via device.load_zimage_pipe, NF4-resident, reuses the shared z-image-turbo
            weights); other non-GGUF → AutoPipelineForInpainting. FLUX Fill fp16 →
            device.load_flux_engine_pipe. `is_zimage` — flow-matching like FLUX, so the
            inpaint/outpaint services fold it into `is_flux` (crisp mask, no negative,
            explicit size). Only one inpaint pipe loaded at a time; slot "inpaint" in
            model_slots (acquire frees the others before load, ADR 0023)
- inpaint.py — user-mask inpainting: repaint the white-masked region with an `inpaint`
            engine. `_padded_box` crops a padded box (`mask_expand` knob grows the region
            first to swallow a subject's soft fringe → no halo). Scale crop into model
            working range: UP to family native res (small edits below training size →
            noise), DOWN to cap for huge crops. Generate, composite back over the
            pixel-exact full-res source (feathered seam). Three feather knobs mirror
            reframe: mask_softness (mask-edge gradient to diffuser), seed_softness (source
            blur under mask), seam_softness (composite alpha); optional hires refine on
            large crops. FLUX Fill: CRISP binary mask + unblurred init (zeroes masked
            init, reads mask in latent space; soft edge → grey haze ring), composite seam
            blends. SD/SDXL keep feathered mask + seed blur. Uses inpaint_engine + reframe
            geometry. Driven by the inpaint job
- outpaint.py — extend to a target ratio: generate the new area with a selectable
            inpaint pipe (load/run via inpaint_engine; `unload` re-exported). Whole-canvas
            composition at a family cap (SD 1.x 768 / SDXL 1024 / FLUX 1024): full canvas
            when it fits, else generated at cap + upscaled, then (only if `refine`, off by
            default) a short low-strength hires pass re-adds the full-res border. Pristine
            source composited back (feathered seam) → source pixel-exact, only border AI;
            VRAM-coordinated. mask/seam/seed widths user-scalable (0..1, 0.5 = default),
            placement via pos_x/pos_y (0.5 = centred). FLUX-aware (like inpaint): FLUX Fill
            gets CRISP binary border mask + UNBLURRED init → mask_softness/seed_softness
            inert, only seam_softness applies; SD/SDXL keep feathered mask + seed blur.
            Negative = Settings.outpaint_negative default + per-run negative. Per-run
            params: steps (composition), refine_steps (hires), guidance, optional sampler
            (samplers.apply_sampler when supported), seed (seeded torch.Generator). Used by
            reframe=outpaint
- edit.py — prompt-based whole-image editing. Loads an `edit` engine into its own cached
            pipe (+ `unload`): FLUX.1 Kontext (`FluxKontextPipeline`, CPU-offloaded) — GGUF
            → `_load_flux_kontext_gguf`; non-GGUF fp16 → `_load_flux_kontext` via
            device.load_flux_engine_pipe (NF4/int8 per effective level, else fp16).
            FLUX.2 (`engine_family` "FLUX.2") →
            `_load_flux2_edit` (`Flux2KleinPipeline` native img2img, dual-module NF4 via
            `device.load_flux2_pipe`; reuses the FLUX.2 generation weights — same slug).
            `edit_image` = one pass (source + instruction, NO mask, NO negative — auto-resizes
            to ~1 MP internally bounding VRAM, result scaled back to source size),
            step-reported (phase "editing"); FLUX.2 decodes inline (resident, own latent
            packing), FLUX.1 Kontext via output_type="latent" (offloaded).
            `_apply_edit_loras` = the shared `loras.apply_lora_set` (family via
            `engine_family`), reset on pipe rebuild. VRAM handoff: slot "edit" in
            model_slots (ADR 0023). Driven by the edit job
- quantize.py — on-the-fly bitsandbytes quantization (ADR 0019): `quant_config(level,
            family)` → diffusers `BitsAndBytesConfig` (nf4 4-bit / int8) or None (fp16 /
            bnb absent); `flux2_quant_config(level)` → a `PipelineQuantizationConfig` that
            NF4/int8s BOTH FLUX.2 modules (transformer + Qwen3 text encoder) in one pipe
            load; `available()` guard; `bytes_per_param`/`heavy_module_gb_fp16` VRAM
            heuristics; `engine_family(engine)` → "FLUX.2" for FLUX.2 klein engines, else
            "FLUX" for the quant-capable Fill/Kontext engines. bnb is installer-managed
            (platform-specific, like torch)
- fit.py — assess(model, level): fits_gpu / fits_offload / too_large / cpu_only vs live
            VRAM+RAM at a load level; drives the UI badge + pipeline device placement.
            Primitive cores (`est_vram_for`/`assess_for`/`quant_levels_for`/`suggest_for`/
            `effective_level`) reused by the model catalog AND the FLUX engines; per-level
            estimate scales the heavy module by bytes/param; `suggest_level` picks the
            best-quality level that fits; `effective_level` = stored map choice else suggested
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
- vram.py — release(): gc + torch.cuda.empty_cache (best-effort). The VRAM handoff
            between the model services goes through model_slots.acquire (ADR 0023), so
            only the current task's model sits in VRAM

# Dependencies
diffusers (>=0.31 for GGUF), transformers, accelerate, huggingface_hub, pillow,
pydantic, psutil, compel, gguf, peft (LoRA), spandrel + spandrel_extra_arches
(Real-ESRGAN + CodeFormer), facexlib (face detect/align for CodeFormer); torch (CUDA/ROCm/CPU).

# Related Modules
- Parent: ../../ (backend)
- Peer: ../routers (controllers that dispatch here)
