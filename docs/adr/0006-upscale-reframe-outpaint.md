---
status: accepted
date: 2026-07-03
---

# Context
The upscaler kept the source aspect ratio. Users want a target format (e.g. turn
a 1:1 image into 16:9) and, ideally, to have the model "invent" content on the
added sides rather than crop or letterbox.

# Decision
Add an optional **reframe** step to the upscale flow with a target aspect ratio
and a strategy:
- **cover** — centre-crop to the ratio (no new pixels).
- **contain** — fit + blurred backdrop fill.
- **edge** — reflect/replicate the border pixels.
- **outpaint** — generate content in the new area with a Stable Diffusion inpaint
  pipeline (`stable-diffusion-v1-5/stable-diffusion-inpainting`, the ungated SD 1.5
  inpainting re-host — SD 2 inpainting is gated), downloaded on demand.

Cover/contain/edge are pure-PIL and run *after* upscaling. **Outpaint is a single
whole-canvas pass** at a moderate working resolution (long side ~768), then the
result is upscaled to full resolution (the `tile` toggle controls that upscale).

Update (20260703): independent per-tile outpainting was implemented first but
removed — each tile hallucinated its own subject (a grid of extra cats) instead of
extending the background. A single whole-canvas pass lets the model see the entire
image and continue it coherently; a hardcoded negative prompt (watermark, text,
duplicate subject, …) further curbs the common failure modes.

# Rationale
- Outpainting via inpaint is the standard "extend an image" technique: existing
  pixels stay fixed (black mask), only the new region (white, feathered mask) is
  denoised, conditioned on the surrounding content + prompt → coherent extension.
- SD inpaint works at ~512–768; a full-res canvas can't be a single pass. Tiling
  the border (mirroring the upscaler's tiling) preserves source detail and scales
  to any output size. The single-pass mode is a cheaper, lower-fidelity fallback.
- Reusing the existing engine registry/download machinery (the inpaint model is
  listed as a non-selectable `kind: "inpaint"` engine) keeps the change small; the
  outpaint step coordinates with the VRAM manager (frees generation + upscalers).

# Consequences
- New `services/reframe.py` (geometry + non-AI strategies) and `services/outpaint.py`
  (inpaint pipe + tiled/single-pass), plus `UpscaleRequest.{target_ratio, reframe}`.
- The outpaint model is a ~4 GB download, gated behind the outpaint strategy.
- Tiled outpaint quality depends on overlap/feather and prompt; seams are mitigated
  but strong prompts can still show mild boundaries.
- Unifying upscaler/outpaint models into the main Models list + custom models is a
  deliberately deferred follow-up feature (kept out to bound this change).
