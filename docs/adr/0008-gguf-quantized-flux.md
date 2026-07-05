---
status: accepted
date: 2026-07-05
---

# Context
The full-precision FLUX repos in the catalog (`flux-dev`, `flux-schnell`) need
~24 GB VRAM and a ~34 GB download, so on common 16 GB GPUs they only run via slow
CPU offloading. Users want FLUX to run comfortably in ~16 GB VRAM. diffusers
(>=0.31) can load a GGUF-quantized transformer via
`FluxTransformer2DModel.from_single_file(..., GGUFQuantizationConfig)`, letting a
Q4/Q5/Q6 FLUX fit a 16 GB budget.

Several quantization approaches exist:
- **On-the-fly** (bitsandbytes NF4 / torchao FP8) — quantize at load; reuses the
  existing full-repo download + AutoPipeline, but still downloads the full ~34 GB.
- **Pre-quantized GGUF single-file** — download one small `.gguf` and load it as
  the transformer; best disk/VRAM, but needs a single-file download path and a
  FLUX-specific loader.

# Decision
Support **GGUF-quantized FLUX**, selected **per catalog entry**. A GGUF entry is a
normal `ModelInfo` carrying two extra optional fields — `gguf_repo_id` and
`gguf_filename` (the `.gguf` transformer source) — while its existing `repo_id`
supplies the remaining components (VAE, CLIP + T5 text encoders, tokenizers,
scheduler). GGUF replaces **only the transformer**, so:

- **Download** fetches the base repo *without* its transformer weight files
  (`resolve_gguf_base_files` keeps the transformer config) plus the single `.gguf`
  into `models/<slug>`.
- **Load** (`pipeline._load_gguf`) builds the transformer from the local `.gguf`
  with `GGUFQuantizationConfig` (bf16 compute dtype) and passes it into
  `FluxPipeline.from_pretrained(base, transformer=...)` — providing the module
  overrides loading that component from disk — then always `enable_model_cpu_offload`
  so the large T5 encoder streams off the GPU and peak VRAM stays low.

Scope for the first version: **FLUX family only**, **curated catalog entries only**.

# Rationale
- Per-entry selection needs no new settings/UI: a quantized variant is just another
  model in the list, so the download, fit-check and generation flows work by slug.
- GGUF gives the best disk/VRAM tradeoff, which is the whole point on a 16 GB GPU;
  on-the-fly quantization would still pull the full 34 GB.
- Replacing only the transformer keeps the change additive behind an `is_gguf`
  branch — the SD/SDXL/normal-FLUX load and download paths are untouched.
- diffusers' native GGUF support means no bespoke dequantization code.

# Consequences
- Adds a `gguf` runtime dependency and raises the diffusers floor to `>=0.31`.
- The base repo still ships the ~9.5 GB fp16 T5 text encoder, so disk is ~17 GB
  even though VRAM is low. Recorded as technical debt; a future fp8/GGUF text
  encoder could shrink it further.
- GGUF loading is FLUX-only; a non-FLUX GGUF entry raises a clear error.
- Custom GGUF models via the HuggingFace browser are out of scope (would need the
  resolve + add-model flow to capture two repos and a filename).
- The GGUF path uses a bf16 compute dtype (FLUX-native), unlike the fp16 used
  elsewhere.
