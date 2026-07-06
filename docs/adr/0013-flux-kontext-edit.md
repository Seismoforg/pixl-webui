---
status: accepted
date: 2026-07-06
---

# Context
Inpaint (ADR 0012) and outpaint (ADR 0006) both need a *mask*. Users also want to
edit an image from a natural-language instruction alone — "change the lighting to a
night scene", "make it look like a painting" — a whole-image, structure-preserving
edit with no mask. The purpose-built model is **FLUX.1 Kontext**, a distinct
diffusers pipeline (`FluxKontextPipeline`) that takes a source image + an instruction
prompt and preserves composition. Like FLUX.1-Fill (ADR 0010) it runs in ~16 GB VRAM
via the GGUF load path (only the transformer quantized).

This is neither a generation model (no text-to-image from scratch) nor an inpaint
engine (no mask), so it does not fit the existing model or `inpaint`-kind engine
catalogs.

# Decision
Introduce a new engine **`kind: "edit"`** and a dedicated service:

- **Engine kind `edit`** in the engine catalog, carrying `gguf_repo_id`/`gguf_filename`
  like the Fill engines. Curated entries: `edit--flux-kontext-gguf-{q4ks,q6k,q8}`
  (base gated `black-forest-labs/FLUX.1-Kontext-dev` + community
  `QuantStack/FLUX.1-Kontext-dev-GGUF`).
- **Service** `services/edit.py` — owns its own cached `FluxKontextPipeline` (loaded
  from the GGUF transformer, CPU-offloaded) and `edit_image`: one Kontext pass
  (source image + instruction, NO mask, NO negative — Kontext is guidance-distilled).
  Kontext auto-resizes the input to its preferred ~1 MP internally (bounding VRAM);
  the result is scaled back to the source size.
- **Router** `routers/edit.py` — background job/endpoint mirroring inpaint:
  `POST /api/edit`, `GET /api/edit/{job_id}` (`EditProgress`), own job store,
  publishes the `edit` WS channel; `batch` variants with incrementing seeds.
- **Frontend** `/edit` page ("Post Processing") + `EditPanel` + `EditProvider`,
  reusing SourcePicker/GalleryPicker/UpscaleStats.
- **VRAM coordination**: `edit.load()` frees the generation/upscale/inpaint models,
  and each of those frees the edit pipe before loading (mutual lazy-import unload).

# Rationale
- A new engine kind (not a model-catalog entry) keeps Kontext out of the
  text-to-image model manager while reusing the engine download/catalog/GPU-fit
  machinery.
- A separate service (own pipe) rather than folding into `inpaint_engine` because
  Kontext is a different pipeline with no mask — sharing would only add branches.
- Mirroring the inpaint job/router/provider shape keeps the WS/progress/gallery
  wiring identical and the shared live-stats UI unchanged.

# Consequences
- Adds a fourth heavy model service to VRAM-coordinate (generation, upscale, inpaint,
  edit); handled by the mutual-unload pattern + the process-wide job guard.
- Depends on a **community** GGUF repo + a **gated** base repo (needs a HuggingFace
  token); recorded in technical debt.
- Whole-image edit, so "enhance quality / remove blur" is limited versus the
  dedicated Upscale path — the UI surfaces an honest note.
- Not runtime-verified in development (gated ~17 GB download + GPU); load/call paths
  are exercised only at real runtime.
