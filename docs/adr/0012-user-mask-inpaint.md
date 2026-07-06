---
status: accepted
date: 2026-07-06
---

# Context
Reframe outpainting (ADR 0006) invents a *border* mask to extend the canvas, but
users also want to repaint an arbitrary region *inside* an image — replace an object,
fix an artifact, swap a background — by painting the mask themselves. This is the
standard inpaint workflow, distinct from outpaint: the mask is user-supplied rather
than derived from the target ratio, and the untouched pixels must stay exact.

The existing `inpaint_engine` module (ADR 0010) already owns the shared inpaint pipe
(SD/SDXL `AutoPipelineForInpainting` or GGUF `FluxFillPipeline`), its load/cache, and
the single `run_inpaint` pass — built for outpaint but engine-agnostic.

# Decision
Add user-mask inpainting as a standalone capability that **reuses** the
`inpaint_engine` stack rather than a new pipeline family:

- **Service** `services/inpaint.py` — repaint the painted region (white in the mask).
  To keep detail on small edits of large images, generation is decoupled from source
  resolution: crop a padded box around the mask (`mask_expand` first grows the region
  so the edit swallows a subject's soft fringe), scale that crop into the model's
  working range (up to native so small edits don't fall below the training size, down
  to the cap for huge crops), generate there, then composite the result back over the
  pristine full-res source with a feathered seam. Three feather knobs mirror reframe
  (mask gradient / seed blur / composite seam). FLUX Fill gets a crisp binary mask +
  unblurred init (see ADR 0006's amendment / feature 0002) — the seam does the blend.
- **Router** `routers/inpaint.py` — a background job/endpoint mirroring reframe:
  `POST /api/inpaint`, `GET /api/inpaint/{job_id}` (`InpaintProgress`), own job store,
  publishes the `inpaint` WS channel; generates `batch` variants with incrementing
  seeds.
- **Frontend** `/inpaint` page + `InpaintPanel` + `InpaintCanvas` (paint-a-mask
  editor) + `InpaintProvider`, reusing SourcePicker/GalleryPicker/UpscaleStats.
- **Curated engine** — a mid-VRAM SDXL inpaint checkpoint (`inpaint--sdxl`) added to
  the engine catalog; the existing GGUF FLUX.1-Fill engines also apply.

# Rationale
- Reusing `inpaint_engine` (one cached pipe, shared load/run/VRAM coordination) means
  outpaint and inpaint never both hold a model, and no inpaint pipeline code is
  duplicated — the new service is only crop/composite geometry.
- Mirroring the reframe job/router/provider/result shape keeps the WS + progress +
  gallery-save wiring identical, so the shared upscale live-stats UI works unchanged.
- Auto-crop + composite-back keeps untouched pixels pixel-exact and lets small edits
  generate at native resolution (avoiding the sub-training-size noise problem).

# Consequences
- Inpaint and outpaint share one inpaint pipe, so they cannot run simultaneously
  (enforced by the process-wide job guard).
- The optional hires refine pass on large crops is un-tiled (same OOM caveat as
  outpaint; recorded in technical debt).
- Not runtime-verified for the GGUF FLUX path in development (gated download + GPU);
  the SD/SDXL crop/composite geometry is verified with PIL.
