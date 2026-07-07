---
status: accepted
date: 2026-07-07
---

# Context
FLUX (and SD 3.x) run in ~16 GB only via GGUF-quantized transformers. GGUF has one
fatal limit: **it cannot apply LoRAs** (the pipeline gates `_apply_loras` to non-GGUF
bases). So a 16 GB GPU could run FLUX but never with a LoRA. The default catalog also
shipped two overlapping 16 GB mechanisms (8 GGUF models + 6 GGUF FLUX Fill/Kontext
engines) alongside the fp16 bases — redundant and confusing.

bitsandbytes on-the-fly quantization (NF4 4-bit / int8) shrinks the heavy denoising
module at load with no separate quant file, and — unlike GGUF — stays LoRA-compatible
(`set_adapters` blends on the quantized module, no 4-bit merge). Proven on this box
(RX 9070 / gfx1201 / ROCm 7.15, community bnb wheel): SDXL NF4 UNet + SD 1.5 NF4 + a
LoRA generate coherent images in ~16 GB.

# Decision
Adopt on-the-fly bitsandbytes NF4/int8 as the **default 16 GB path** and **retire GGUF
from the bundled default catalog** (still re-addable by hand).

- Per-entry load-time level `{slug: fp16|int8|nf4}` in `AppSettings.load_quantization`,
  set on the Models page, read at load. Absent slug → auto-suggested level (highest
  quality that fits live VRAM). `services/quantize.py` builds the `BitsAndBytesConfig`
  + VRAM heuristics; `services/fit.py` scores per-level fit + suggests.
- Quantized load quantizes the heavy module (transformer for FLUX/SD 3.x, UNet for
  SD 1.5/SDXL) from the local fp16 weights and CPU-offloads (like GGUF) — in
  `pipeline.py` (generation), `inpaint_engine.py` (FLUX Fill), `edit.py` (FLUX Kontext).
- Default catalogs: removed all 14 GGUF entries; added fp16 `inpaint--flux-fill` +
  `edit--flux-kontext` (loaded at their suggested NF4/int8 level). GGUF machinery
  (catalog `gguf_*` fields, GGUF load branches, editor GGUF fields) is fully kept.
- Installer ships bnb platform-matched: CUDA → PyPI wheel; AMD/ROCm-Windows → the
  community wheel via the rocm-torch-windows module (matched to rocm+gfx+py); CPU →
  skipped. Absent bnb → the quant path is guarded (`quantize.available()`) and degrades
  to fp16-only.

# Rationale
- NF4 delivers the one thing GGUF can't: FLUX **with LoRAs** in 16 GB.
- One 16 GB mechanism (NF4), not two. Simpler default catalog; GGUF stays opt-in.
- No extra quant file to host/download — quantized at load from the fp16 base.
- fp16 stays the untouched default when a level isn't set; GGUF entries load exactly
  as before.

# Consequences
- The fp16 FLUX Fill/Kontext repos are **gated** (need an HF token + accepted license),
  where the removed community GGUF requants were not. `/edit` now needs the token.
- The bnb dependency is platform-specific and installer-managed (not a pyproject dep),
  like torch. The ROCm/Windows community wheel is pinned to (rocm major.minor, gfx, py)
  — a maintenance/fragility burden (tracked in technical-debt.md).
- Fresh installs (no `data/*_catalog.json` override) no longer show the GGUF entries;
  users re-add them or use NF4. Existing overrides are untouched.
- VRAM fit is a heuristic (bytes/param × heavy-module params); the badge/suggestion can
  differ from measured VRAM at the margins.
