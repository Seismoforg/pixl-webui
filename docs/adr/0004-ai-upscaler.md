---
status: accepted
date: 2026-07-03
---

# Context
Pixl WebUI could generate images but not enlarge them. Users want to upscale an
image — either one from the gallery or an uploaded file — with an AI upscaler,
and the required model should download into the local `models/` folder on demand
like generation models do.

Two upscaler approaches were considered:
- **Real-ESRGAN** (a GAN upscaler) — fast, prompt-free, the "standard" AI photo/
  anime upscaler; a single ~65 MB `.pth` weight loaded via `spandrel`.
- **Stable Diffusion x4 upscaler** (diffusion) — reuses the existing diffusers
  stack, optional text prompt, but slower and VRAM-heavy.

# Decision
Implement **both** as selectable upscaler *engines* behind one registry
(`services/upscalers.py`), one service (`services/upscale.py`) that dispatches by
engine `kind`, and one job endpoint (`routers/upscale.py`). Each engine downloads
on first use, reusing the existing download/progress machinery (single-file
`hf_hub_download` for Real-ESRGAN; diffusers `snapshot_download` for SD x4).

Large inputs are optionally **tiled**: the image is split into overlapping tiles,
each upscaled independently and stitched back, so peak VRAM stays bounded and
inference is faster. Tiling is user-controllable (Auto = tile only when the image
exceeds the tile size; Off = single pass / capped input).

# Rationale
- The two engines cover different needs (fast/faithful vs. detail-synthesizing)
  without forcing one tradeoff on every user.
- `spandrel` (MIT) robustly loads ESRGAN-family `.pth` checkpoints, so the
  Real-ESRGAN path is a small, self-contained addition.
- SD x4 reuses the diffusers pipeline patterns already in the codebase.
- Tiling is the standard way to upscale beyond a single GPU's memory budget and
  keeps the SD x4 path usable at full resolution.

# Consequences
- Adds a `spandrel` runtime dependency (installed via `pyproject.toml`).
- Upscaler weights live under `models/<slug>` and appear to the download
  machinery like any other model (progress/delete reuse it).
- Tiled diffusion output can show mild seams on strong prompts; overlap trimming
  mitigates this but does not fully blend — acceptable for an upscaler.
- Results are saved to the gallery with placeholder generation metadata
  (`sampler="upscale"`, zeroed steps/seed) since upscaling has no seed/steps.
