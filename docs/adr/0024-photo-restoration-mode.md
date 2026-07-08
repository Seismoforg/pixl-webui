---
status: accepted
date: 2026-07-08
---

# Context
Users want ChatGPT-class old-photo restoration, but LOCAL + offline. A single
big-model "beautify" (FLUX.2 klein edit) drifts geometry/identity (autoregressive
regeneration, not pixel-faithful). Running every model on every photo also wastes
compute and over-restores clean images.

# Decision
Add a `/restore` WebUI mode: an **analysis-driven** pipeline. Analyze the photo first
(classical CV), then build the station chain from MEASURED metrics + a preset; run
only the stations that help. Stations reuse the existing engine (Real-ESRGAN,
CodeFormer, FLUX/Kontext edit, Z-Image img2img) plus new classical steps
(white-balance, cv2 scratch inpaint, NL-means denoise, CLAHE tone).

Key pieces:
- `services/analysis.py` — quality/damage/face report (Laplacian blur, Immerkær noise,
  morphology scratch/dust, CLAHE contrast, facexlib RetinaFace face count on CPU).
- `services/restore_engine.py` — rule-based `build_plan` (per-station thresholds +
  user overrides) + `run_pipeline` orchestrator; keeps a downscaled before/after
  preview per station. Per-role model override (`resolve_engines`).
- `routers/restore.py` — `/api/restore` job + `/presets` + `/engines`; writes
  analysis.json / pipeline.json / processing.log sidecars under `outputs/restore/<job>`.
- Frontend `/restore` mode: source + preset + station conveyor (on/off + one slider)
  + per-role model pickers + damage report + pipeline viz + per-station Before/After.

**Prior-fusion (the generative beautify):** FLUX.1 Kontext, a STRUCTURE-PRESERVING
whole-image edit (keeps faces/pose/composition), with a prompt written to remove
damage and preserve identity/colour — never to add an aged look. `strength` alpha-
blends the beautify over the faithful input. It runs BEFORE the face station so
CodeFormer (identity-preserving) gets the last word on faces. Off by default on
Balanced (it's the riskiest station — can still drift on heavy damage); on for Maximum.

An earlier design added a Z-Image img2img "pull-back" after the beautify — removed: a
text2img model doing img2img has no identity anchor, so it invented new faces and
shifted colour. True fidelity-net fusion (ControlNet/Restormer) remains future work.

Decision engine is rule-based first (deliberately swappable for an ML classifier).

**Colorize station:** DDColor (ICCV 2023), loaded via spandrel (`colorize` engine kind,
like CodeFormer) — takes lightness `(1,1,H,W)`, predicts colour. Opt-in (off in every
preset, never automatic), `strength` alpha-blends the colour over the original. Runs
after the beautify, before tone/upscale.

**Colour-mode analysis + guard:** `analysis.classify_color` classifies the source into
grayscale / sepia / color / faded from saturation + LAB a/b variance & offset (a/b
VARIANCE separates true B&W ≈0 from faded colour — real chroma at low saturation),
soft-scored (softmax) to a confidence per class. Two uses:
- Beautify prompt built from the detected mode (`beautify_prompt_for`) when the user
  gives none — a B&W photo is told to STAY B&W, never asked to gain colour.
- A deterministic guard (`enforce_color_mode`, in `restore.py` after the pipeline):
  confident grayscale (score ≥ 0.85) AND colorize station NOT run → coerce the result
  back to grayscale, so no colour can creep in via Kontext/upscale regardless of what
  those stations did. Grayscale-only — sepia over-fires on warm colour photos, so sepia
  is prompt-preserved, not coerced. Colorize (opt-in) is the ONLY path to colour on a
  mono source. Logged in pipeline.json (`color_mode` + `color_guard_applied`).

# Rationale
- Analysis-driven avoids over-restoration and wasted model loads.
- Reusing the existing engine (one heavy model resident via `model_slots`) keeps VRAM
  bounded and avoids new heavy deps for v1.
- Classical stations (scratch/denoise/tone) need no model — fast, no hallucination.
- Kontext's structure preservation is the local advantage that makes prior-fusion
  viable without a trained fidelity net.

# Consequences
- The generative beautify (Kontext) can still drift on heavy damage — hence off by
  default on Balanced; a true fidelity net (ControlNet/Restormer) is future work.
- The chain loads/unloads several models sequentially (slow, VRAM-safe). The Kontext
  beautify caps to ~1 MP internally (bounds VRAM).
- Kontext's offloaded decode fails on extreme aspect ratios (>~2.5:1) — a pre-existing
  `edit.py` limit; prior-fusion degrades gracefully (see technical-debt).
- Colour-mode is rule-based (swappable for an ML classifier); a very faded colour photo
  near the grayscale boundary could be desaturated — bounded by a/b variance, the 0.85
  guard gate, and faded never being coerced.
- Deferred to P2/P3: quality-validation station, natural grain, batch, export formats
  (16-bit TIFF), colorization (DDColor/DeOldify), dedicated denoise/deblur/background
  model plugins, auto-mask, ML decision engine, the interactive 3-way faded-colour
  choice (Preserve / Restore colours / AI Colorize).
