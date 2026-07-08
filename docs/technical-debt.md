# Technical Debt

## Photo-restoration beautify still drifts + Kontext extreme-aspect decode fails  (added 2026-07-08)
- Problem: (1) The restore prior-fusion beautify (ADR 0024) is FLUX.1 Kontext (structure-
  preserving) — no real fidelity net, so on heavy damage it can still alter faces/detail;
  it's off by default on Balanced and CodeFormer runs after it to re-anchor faces. (An
  earlier Z-Image img2img pull-back was removed — it hallucinated new faces.) (2)
  `edit.edit_image` (Kontext) offloaded decode (`decode_flux_latents` → `_unpack_latents`)
  raises a shape error on extreme aspect ratios (>~2.5:1) — the internally-adjusted
  height/width don't match the packed latent grid. Pre-existing in edit.py, surfaced by
  restore feeding wide panoramas.
- Impact: (1) Generative restore quality is bounded vs a hosted model (gpt-image-1); the
  reliable default is the deterministic chain (scratch/denoise/face/tone/upscale). (2)
  prior-fusion is silently SKIPPED for very wide/tall photos (degrades gracefully). Also
  hits the /edit page directly with extreme aspects.
- Proposed Resolution: (1) add a ControlNet / real fidelity-net beautify (bigger scope);
  (2) fix `decode_flux_latents` to use the pipeline's ADJUSTED height/width (or snap edit
  inputs to a supported aspect) so Kontext decodes at any aspect.

## Community bitsandbytes wheel on ROCm/Windows is fragile  (added 2026-07-07)
- Problem: On-the-fly NF4/int8 quantization (ADR 0019) needs bitsandbytes, but AMD/
  ROCm-on-Windows has no official wheel. The installer relies on a community wheel
  (0xDELUXA fork, a `dev0` build) matched to (rocm major.minor, gfx arch, py) via the
  rocm-torch-windows module. Pinned to a narrow support matrix.
- Impact: A new ROCm/gfx/Python combo with no matching wheel silently degrades the app
  to fp16-only (FLUX no longer fits 16 GB, LoRAs on FLUX unavailable). The `dev0` build
  may break against future bnb/torch versions.
- Proposed Resolution: Track official ROCm bitsandbytes support and switch to it when
  available; widen the community wheel matrix in rocm-torch-windows meanwhile.

## SDXL/SD inpaint engines don't expose on-the-fly quantization  (added 2026-07-07)
- Problem: ADR 0019 wires NF4/int8 only for generation models + the FLUX Fill/Kontext
  engines. The SD/SDXL inpaint engines (`inpaint--sdxl`, `outpaint--sd-inpaint`) still
  load fp16 only — `quantize.engine_family` returns None for them.
- Impact: No lighter-VRAM option for the SDXL inpaint engine; minor (it already fits
  ~10 GB). Inconsistent with the generation UNet path, which does quantize SDXL.
- Proposed Resolution: Extend the engine quant path to UNet inpaint pipelines
  (`AutoPipelineForInpainting` with a pre-quantized `unet=`) if the VRAM saving is wanted.

## Curated LoRA entries depend on community repo filenames  (added 2026-07-06)
- Problem: The curated LoRA catalog (`app/loras_catalog.json`) pins each entry's
  `repo_id` + exact `filename` (e.g. `nerijs/pixel-art-xl` → `pixel-art-xl.safetensors`).
  A community repo can rename/move the weight file or disappear; the single-file
  download then 404s. Same class of risk as the Flux Fill/Kontext GGUF note below.
- Impact: A curated LoRA can break with a download error until its catalog entry is
  fixed (editable in Settings → Curated LoRAs).
- Proposed Resolution: Periodically verify the pinned repos/filenames, or resolve the
  weight filename from the repo listing instead of hardcoding it.

## Frontend inspect harness: only the shared-browser core is built  (added 2026-07-06)
- Problem: The Playwright harness (`frontend/e2e`) ships only the shared-browser inspect
  core — Claude attaches over CDP to a browser the user drives (`test-frontend.bat`).
  The planned add-ons are NOT built: a headless mock-backend harness (deterministic
  self-driven states via `page.route` + `routeWebSocket`), regression specs
  (nav/generate/gallery/errors), and an opt-in live real-GPU generation smoke.
- Impact: No automated regression coverage or self-driven (no-user) inspection yet;
  inspecting needs the user to run `start.bat` + `test-frontend.bat` and drive the browser.
- Proposed Resolution: Add the mock-backend fixture + `snap` helper + regression/a11y
  specs and the `@live` generation smoke as a follow-up feature when durable coverage
  is wanted.

## Removing a downloaded catalog entry orphans its files  (added 2026-07-05)
- Problem: The Settings catalog editors edit the curated list only. Deleting an
  entry (or changing its slug) that was already downloaded leaves the weights in
  `models/<slug>` on disk — they are no longer listed, so the UI offers no way to
  reclaim the space.
- Impact: Orphaned model/engine folders accumulate disk usage after catalog edits;
  the user must delete them manually from `models/`.
- Proposed Resolution: On catalog save, detect downloaded slugs that no longer
  appear and offer to delete their folders (or surface an "orphaned downloads"
  cleanup action on the Models page).

## Flux Fill/Kontext GGUF engines depend on community GGUF repos  (added 2026-07-05, widened 2026-07-06)
- Problem: The curated `outpaint--flux-fill-gguf` engine pulls its transformer from
  a community GGUF repo (`YarvixPA/FLUX.1-Fill-dev-GGUF`) and its base components
  from the gated `black-forest-labs/FLUX.1-Fill-dev` (needs a HuggingFace token).
  The same pattern now applies to the `edit--flux-kontext-gguf-*` engines (community
  `QuantStack/FLUX.1-Kontext-dev-GGUF` + gated `black-forest-labs/FLUX.1-Kontext-dev`).
- Impact: The community repo could move/rename/disappear, and the gated base fails
  to download without a token; either breaks the engine with a download error.
- Proposed Resolution: Pin/verify the GGUF repo periodically (or mirror it), and
  surface a clear "needs token / repo unavailable" message when the download 401s.

## torch.compile toggle is inert without Triton on ROCm  (added 2026-07-05)
- Problem: The `torch_compile` performance setting needs Triton (inductor's GPU
  backend), which is not installed on ROCm (`pytorch-triton-rocm`). Without it,
  `apply_compile` guards and no-ops, so the toggle has no effect on AMD setups.
- Impact: Users can enable the toggle but get no speedup on ROCm until Triton is
  installed; the potential torch.compile win is unrealized there.
- Windows finding (researched 2026-07-05): AMD's official "PyTorch on Windows"
  ROCm repo (repo.radeon.com/rocm/windows/rocm-rel-7.2.1 and 7.1.1) ships torch/
  torchvision/torchaudio but **no Triton wheel**, and the Windows install docs do
  not mention Triton/torch.compile. So on Windows+ROCm there is currently NO
  supported Triton, and torch.compile is not achievable via the official channel.
  Only Linux ROCm ships `pytorch-triton-rocm`. The community `triton-windows` fork
  is CUDA-focused (AMD support is early-stage, issue #179).
- Proposed Resolution: On Linux/ROCm, install a matching `pytorch-triton-rocm` in
  `install.ps1` and re-measure it/s. On Windows/ROCm, revisit only once AMD
  publishes a Windows Triton wheel (or the triton-windows AMD port matures).

## GGUF models still download the full fp16 text encoder  (added 2026-07-05, widened 2026-07-06)
- Problem: A GGUF entry downloads the base repo's full fp16 text encoder(s) even
  though only the transformer is quantized, so on-disk size is ~17 GB despite the low
  (~16 GB) VRAM footprint. Applies to every GGUF entry — FLUX generation, FLUX.1-Fill
  outpaint, FLUX.1-Kontext edit (~9.5 GB fp16 T5 each), and SD 3.5 Large (its T5 +
  dual CLIP encoders).
- Impact: Larger download/disk than the VRAM budget implies; no separate control to
  pick a smaller text encoder.
- Proposed Resolution: Support an fp8/GGUF T5 text encoder (swap the
  `text_encoder_2` component at load) to shrink the base download.

## Download progress is polled, size-based  (added 2026-07-03)
- Problem: Download progress is derived by comparing on-disk bytes against the
  repo's total size and polled by the frontend, rather than streamed (SSE/WS).
- Impact: Progress can be slightly coarse/laggy; no per-file detail.
- Proposed Resolution: Switch to server-sent events with `huggingface_hub`
  progress callbacks once the MVP is stable.

## Single-model pipeline cache  (added 2026-07-03)
- Problem: Only one diffusers pipeline is kept in memory; switching models
  unloads the previous one.
- Impact: Frequent model switching re-loads weights from disk.
- Proposed Resolution: Optional LRU cache of N pipelines gated by available VRAM.

## Xet backend disabled on Windows  (added 2026-07-03)
- Problem: HuggingFace's Xet download backend (`hf_xet`) writes temp files under
  `.cache/huggingface/download/` whose names trigger `[WinError 123]` on Windows,
  so we force `HF_HUB_DISABLE_XET=1` in `config.py`.
- Impact: Downloads use the classic HTTPS path, which can be slower than Xet for
  Xet-backed repos (e.g. FLUX).
- Proposed Resolution: Re-enable Xet once the Windows path issue is fixed upstream
  in `hf_xet` / `huggingface_hub`.

## Secondary color fails WCAG AA on light backgrounds  (added 2026-07-03)
- Problem: The brand secondary `#ec4899` used as outlined-chip text/border
  (e.g. the pipeline-tag chip in ModelListItem) contrasts only ~3.5:1 against the
  light-mode paper (`#ffffff`), below the WCAG AA 4.5:1 threshold for small text.
  It passes on the dark theme (~5:1). Primary was darkened to `#5457e0` to clear
  AA for the contained button; secondary was left as-is to preserve brand identity.
- Impact: Small pink chip labels are harder to read in light mode.
- Proposed Resolution: Either introduce a darker `secondary` shade specifically
  for on-light text, or restyle those chips to use `text.primary` with a colored
  border only.

## Frontend rebuilds on every launch  (added 2026-07-04)
- Problem: `start.bat` runs `npm run build && npm run start` so it always serves a
  production build (dev mode caused 1-2s on-demand route compiles). The build is
  incremental (reuses `.next/cache`) but still runs each launch rather than being
  produced once at install time.
- Impact: First launch after a change has a short build delay before the frontend
  is reachable; the browser auto-open (6s) may briefly precede readiness on the
  first/cold build.
- Proposed Resolution: Optionally move `npm run build` into `install.ps1` and have
  `start.bat` run only `next start`, rebuilding on demand.

## compel pulls a heavy transitive dependency (notebook/jupyter)  (added 2026-07-04)
- Problem: `compel>=2.0` (used for long/weighted prompts in
  `services/prompt_embeds.py`) declares `notebook` as a runtime dependency, which
  drags in the whole JupyterLab/notebook stack (~60 packages) on install.
- Impact: Bloated backend virtualenv; longer install, more disk. No runtime effect
  on the API itself.
- Proposed Resolution: Pin/patch to a compel release that drops the `notebook`
  dep, vendor the small slice we use, or switch to a lighter long-prompt approach
  (manual token chunking / `sd_embed`) if the bloat becomes a problem.

## compel SDXL pos/neg padding is worked around manually  (added 2026-07-04)
- Problem: compel 2.4's `pad_conditioning_tensors_to_same_length` crashes for
  SDXL's dual-encoder provider (`EmbeddingsProviderMulti` has no `empty_z`), so
  `services/prompt_embeds.py` encodes positive/negative separately and zero-pads
  the shorter to equal length itself.
- Impact: Zero-padding is a slight approximation of compel's empty-string padding;
  the workaround may break or become redundant on a compel upgrade.
- Proposed Resolution: Revisit on the next compel upgrade — adopt the
  `CompelForSDXL` convenience wrapper (or upstream fix) once it handles differing
  pos/neg lengths, and drop the manual padding.

## Inpaint/outpaint hires refinement pass is un-tiled  (added 2026-07-05, widened 2026-07-06)
- Problem: The hires refinement pass in `services/outpaint.py` (large reframe canvas)
  and `services/inpaint.py` (large user-mask crop) runs a single full-resolution
  inpaint with no tiling/OOM fallback when the canvas/crop exceeds the family cap.
  Unlike `services/upscale.py`, neither tiles large inputs.
- Impact: Very large reframes (e.g. a 2K+ source to an ultrawide ratio) or a big
  painted region can spike VRAM in the refinement pass on constrained GPUs; only
  cpu-offload + attention slicing bound it. Not yet verified on low-VRAM hardware.
- Proposed Resolution: Cap the refinement resolution, or tile the refinement pass
  like the upscaler, if OOM shows up in practice.

## AMD gfx-arch mapping is static  (added 2026-07-03)
- Problem: The AMD GPU → gfx architecture mapping in `install.ps1` is hardcoded
  from the current rocm-torch-windows support list.
- Impact: New AMD GPUs need a manual mapping update.
- Proposed Resolution: Delegate arch detection to rocm-torch-windows where
  possible, or fetch the mapping from it.

## FLUX.2 klein catalog sizes/min_vram are unverified  (added 2026-07-08)
- Problem: The `flux2-klein-4b`/`flux2-klein-9b` entries (models + edit engines) ship
  hand-estimated `approx_size_gb` (25/35) and `min_vram_gb` (30/33) — the 9B is a
  gated 35 GB download, so the real footprint, distilled steps/guidance, and the exact
  dual-NF4 resident VRAM were not measured. The `_HEAVY_PARAMS_B["FLUX.2"]` value (17.0,
  both modules) is a single family figure that can't distinguish 4B from 9B.
- Impact: The fit badge + auto-suggested NF4 level may be slightly off until tuned on a
  real download; defaults may not match the model card.
- Proposed Resolution: After a real gated download, measure resident NF4-both VRAM +
  confirm the model-card steps/guidance and correct the catalog `min_vram_gb`/
  `approx_size_gb`/`defaults`.

## FLUX.2 klein outpaint/inpaint deferred  (added 2026-07-08)
- Problem: FLUX.2 klein has NO mask pipeline in diffusers (issue #13005 open), so it is
  wired only as a generation family + native-img2img `edit` engine. Mask-based
  outpaint/inpaint (green-screen + an outpaint LoRA) was scoped as "Tier C" but deferred.
- Impact: FLUX.2 klein is unavailable for the reframe=outpaint + user-mask inpaint flows
  (SD/SDXL/FLUX.1-Fill/Z-Image still cover those).
- Proposed Resolution: Revisit when diffusers ships a Flux2 inpaint pipeline, or wire the
  green-screen + fal outpaint-LoRA path (4B base) through `inpaint_engine`. See feature
  20260707-0015.

## FLUX.2 LoRA family doesn't distinguish 4B vs 9B  (added 2026-07-08)
- Problem: FLUX.2 klein 4B (hidden dim 3072) and 9B (4096) share the catalog family
  "FLUX.2", but their LoRAs are size-specific. The LoRA picker + `_apply_loras` only
  match on the family string, so a 9B LoRA can be selected for a 4B model (and vice
  versa) → `load_lora_weights` raises a raw size-mismatch error mid-run.
- Impact: Confusing failure (ugly torch error) when a LoRA's size doesn't match the
  selected model; no pre-flight guard. Ultra Real 9B is marked "9B ONLY" only in prose.
- Proposed Resolution: Split the family (e.g. "FLUX.2-4B" / "FLUX.2-9B") or add a size
  tag to LoraInfo + validate it against the model before load, surfacing a clear message.

## CodeFormer face restoration — deps + weight source + GPU detector  (added 2026-07-08)
- Problem: (a) facexlib auto-downloads its RetinaFace + parsing weights (~100 MB) from
  its own URLs to `models/facexlib` on first restore — needs network the first time,
  not covered by the normal engine download. (b) The `codeformer.pth` weight comes
  from a community HF mirror (`Arun-Subramanian/codeformer-v0.1.0`), not an official
  upstream repo — could vanish. (c) Face detection runs on CPU because RetinaFace
  batch-norm forward raises `miopenStatusUnknownError` on ROCm/gfx1201 GPU.
- Impact: First face restore needs internet even after the engine is "downloaded";
  a removed mirror breaks new installs; CPU detection adds a little latency (tiny net,
  negligible) and the MIOpen GPU crash is unexplained (may bite other small nets).
- Proposed Resolution: Fold the facexlib weights into the engine download (or host all
  three files in one owned repo); revisit GPU detection once the MIOpen issue is
  understood (or a newer ROCm fixes it).

## Civitai downloads are unvalidated + no delete/size pre-check  (added 2026-07-08)
- Problem: `downloader.start_civitai_download` streams a Civitai version file with the
  `civitai_token`, but it's untested against the live API (needs a real key).
  No pre-flight size (progress total comes only from Content-Length), and
  `delete_model` works by slug so it's fine, but there's no Civitai-specific error
  mapping beyond 401/403.
- Impact: First real Civitai download may surface edge cases (redirects, rate limits,
  missing Content-Length → no progress bar).
- Proposed Resolution: Test against the live Civitai API with a key; add the model-info
  size pre-fetch (civitai API v1) for an accurate progress total.
