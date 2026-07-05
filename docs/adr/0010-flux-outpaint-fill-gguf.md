---
status: accepted
date: 2026-07-05
---

# Context
Reframe outpainting only supported SD/SDXL inpaint pipelines
(`AutoPipelineForInpainting`). Users wanted Flux-quality border continuation. The
purpose-built model is **FLUX.1-Fill-dev**, which needs `FluxFillPipeline` and — to
run in ~16 GB VRAM — the GGUF load path (only the transformer quantized; the base
repo supplies the VAE / text encoders / scheduler). This builds directly on the
GGUF generation work (ADR 0008), which put `gguf_repo_id`/`gguf_filename` on
`ModelInfo` and a base-minus-transformer + single-`.gguf` download path in the
downloader.

# Decision
Support FLUX.1-Fill-dev as a curated **inpaint engine**, selected in the existing
reframe outpaint engine picker. Because `upscale.to_model_info` already wraps an
engine as a `ModelInfo` for the downloader, adding `gguf_repo_id`/`gguf_filename`
to `UpscalerInfo` and forwarding them makes the GGUF download reuse the ModelInfo
path unchanged — no new download code. In `outpaint.py`, branch on `engine.is_gguf`:

- **Load** (`_load_flux_fill`): build the transformer from the local `.gguf`
  (`GGUFQuantizationConfig`, bf16) and pass it into `FluxFillPipeline.from_pretrained`,
  then `enable_model_cpu_offload()`.
- **Call**: FLUX Fill is guidance-distilled — it takes no `negative_prompt` — so the
  Flux path omits it and passes explicit `height`/`width`; it *does* support
  `strength`, so the two-pass hires-refinement is kept. Working cap is 1024 (FLUX
  native). The sampler is inert (flow-matching) and skipped.

The curated engine uses base `black-forest-labs/FLUX.1-Fill-dev` (gated) + gguf
`YarvixPA/FLUX.1-Fill-dev-GGUF` (`flux1-fill-dev-Q4_K_S.gguf`).

Scope v1: **FLUX.1-Fill-dev via GGUF only.** Non-GGUF Fill (24 GB fp16) and
regular-Flux inpaint are out of scope.

# Rationale
- Reusing `to_model_info` + the ModelInfo GGUF path avoids duplicating download
  logic and keeps the change additive behind `is_gguf`/`is_flux`.
- FluxFillPipeline supporting `strength` means the existing composition + hires
  refinement flow needed no structural change, only kwargs adjustments.
- Selecting via the existing inpaint engine picker means no new UI surface beyond
  Flux-aware defaults (hide sampler, guidance ≈30 / steps ≈50).

# Consequences
- Adds a curated engine that depends on a **community** GGUF repo (`YarvixPA/...`)
  and a **gated** base repo (needs a HuggingFace token). Recorded in technical debt.
- FLUX Fill is heavier per step than SD inpaint; outpainting is slower, and on
  ROCm the GGUF dequant cost applies (see ADR 0008 / 0009).
- Not runtime-verified in development (gated ~17 GB download + real GPU); the load
  and call paths are exercised only at real runtime.
- The Flux branch uses a bf16 compute dtype, unlike the fp16 SD inpaint path.
