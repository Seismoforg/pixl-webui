---
status: accepted
date: 2026-07-03
---

# Context
The WebUI needs a Python inference engine for Stable Diffusion / image
generation models. Candidates: HuggingFace `diffusers`, ComfyUI as a backend,
or the Automatic1111 API. The project goal is a simple, clean, self-contained
solution supporting SD 1.5, SDXL, FLUX and SD 3.x.

# Decision
Use HuggingFace `diffusers` directly as the inference engine.

# Rationale
- One clean Python codebase that works with both CUDA and ROCm PyTorch builds.
- `AutoPipelineForText2Image` supports the target model families generically.
- No heavyweight node-graph runtime or legacy WebUI to embed and maintain.
- Integrates naturally with `huggingface_hub` for project-local downloads.

# Consequences
- We own the pipeline lifecycle (load, device placement, dtype, unload).
- Advanced features (ControlNet, custom node graphs) are not available out of
  the box and would be added explicitly if needed.
- Model-specific quirks must be handled in our pipeline service.
