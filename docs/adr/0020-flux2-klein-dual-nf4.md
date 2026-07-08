---
status: accepted
date: 2026-07-08
---

# Context
FLUX.2 [klein] (4B + 9B) is a new pipeline family (`Flux2KleinPipeline`). Unlike
FLUX.1, its text encoder is an **8B Qwen3** model that alone nearly fills 16 GB at bf16,
so NF4-ing only the transformer (the FLUX.1 path, ADR 0019) does not fit the 9B in 16 GB.
diffusers ships no FLUX.2 mask (inpaint/outpaint) pipeline yet (issue #13005).

# Decision
Wire FLUX.2 klein as catalog family `"FLUX.2"` with a **dual-module NF4 load**.

- `device.load_flux2_pipe` builds one `Flux2KleinPipeline` with a
  `PipelineQuantizationConfig` (`quantize.flux2_quant_config`) that bitsandbytes-NF4/int8s
  **BOTH** heavy modules — transformer AND the 8B Qwen3 text encoder — in a single load,
  placed by the fit verdict. So the 9B fits ~16 GB resident.
- Generation: `pipeline._load_flux2` (text2img only in v1; reference-image/LoRA-preflight
  minimal). Flow-matching → sampler hidden.
- Edit: `edit._load_flux2_edit` — native img2img `edit`-kind engines (4B + 9B) that
  **reuse the generation weights** (same slug, no extra download).
- Needs diffusers `>=0.39` (`Flux2KleinPipeline` + `PipelineQuantizationConfig`) and
  transformers `>=4.51` (Qwen3). Floors bumped in `pyproject.toml`.
- Licensing: 4B is Apache-2.0; 9B is gated, non-commercial.

# Rationale
- Dual-NF4 is the only way the 9B (encoder + transformer) fits 16 GB — single-module
  NF4 leaves the bf16 encoder too big.
- Reusing generation weights for the edit engine avoids a second multi-GB download.
- One pipeline class for both sizes keeps the load path uniform.

# Consequences
- Catalog `approx_size_gb`/`min_vram_gb` + distilled steps/guidance are **hand-estimated**
  (9B gated, unmeasured) — fit badge / auto-NF4 may be off until tuned (technical-debt).
- FLUX.2 LoRAs are 4B/9B **size-specific** but share family `"FLUX.2"` → a wrong-size
  pick errors raw at `load_lora_weights` (no pre-flight guard; technical-debt).
- No FLUX.2 outpaint/inpaint (no diffusers mask pipeline) — deferred to feature
  20260707-0015 (green-screen + outpaint LoRA); SD/SDXL/FLUX.1-Fill/Z-Image still cover masks.

# Related
- ADR 0019 (on-the-fly NF4), ADR 0013 (FLUX Kontext edit), ADR 0015 (LoRA adapters)
