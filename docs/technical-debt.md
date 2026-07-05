# Technical Debt

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

## Flux Fill outpaint depends on a community GGUF repo  (added 2026-07-05)
- Problem: The curated `outpaint--flux-fill-gguf` engine pulls its transformer from
  a community GGUF repo (`YarvixPA/FLUX.1-Fill-dev-GGUF`) and its base components
  from the gated `black-forest-labs/FLUX.1-Fill-dev` (needs a HuggingFace token).
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

## GGUF FLUX still downloads the full fp16 T5 encoder  (added 2026-07-05)
- Problem: A GGUF FLUX entry downloads the base repo's ~9.5 GB fp16 T5 text encoder
  even though only the transformer is quantized, so on-disk size is ~17 GB despite
  the low (~16 GB) VRAM footprint.
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

## Outpaint hires refinement pass is un-tiled  (added 2026-07-05)
- Problem: `services/outpaint.py`'s hires refinement pass runs a single full-canvas
  inpaint (no tiling/OOM fallback) when the reframe canvas exceeds the family cap.
  Unlike `services/upscale.py`, it does not tile large inputs.
- Impact: Very large reframes (e.g. a 2K+ source to an ultrawide ratio) can spike
  VRAM in the refinement pass on constrained GPUs; only cpu-offload + attention
  slicing bound it. Not yet verified on low-VRAM hardware.
- Proposed Resolution: Cap the refinement resolution, or tile the refinement pass
  like the upscaler, if OOM shows up in practice.

## AMD gfx-arch mapping is static  (added 2026-07-03)
- Problem: The AMD GPU → gfx architecture mapping in `install.ps1` is hardcoded
  from the current rocm-torch-windows support list.
- Impact: New AMD GPUs need a manual mapping update.
- Proposed Resolution: Delegate arch detection to rocm-torch-windows where
  possible, or fetch the mapping from it.
