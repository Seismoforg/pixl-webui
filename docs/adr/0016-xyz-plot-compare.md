---
status: accepted
date: 2026-07-07
---

# Context
Users tuning a prompt want to see how one or two generation parameters affect the
output side by side (the A1111 "X/Y/Z plot"): e.g. steps × guidance, or sampler ×
seed. Doing this by hand means many single runs + manual collation. The parameters
worth sweeping are a small bounded set (steps, guidance, sampler, seed).

# Decision
- **Router** `routers/compare.py` — `POST /api/compare` starts a background job:
  base generate params + `axes` = 1-3 `{param, values}` sweeps over a whitelist
  (`steps`/`guidance_scale`/`sampler`/`seed`). X = columns, Y = rows, Z = one sheet per
  value. Loops `pipeline.generate` over the cartesian product under ONE model load;
  capped at `MAX_CELLS = 64` to bound the combinatorial blow-up.
- **Grid compose** `services/grid.py` — pure-PIL labelled contact-sheet grid (one sheet
  per Z value), saved to the gallery like any other result.
- **Progress** reuses the shared `BatchProgress` shape (cell index = batch index); own
  job store via `services.jobs`; publishes the `compare` WS channel.
- **Frontend** `/compare` page + `ComparePanel` + `AxisEditor` molecule + `CompareResult`
  (thin `BatchImageResult` wrapper, one Z-slice sheet per result image); state in
  `CompareProvider`. Live cell-count + over-cap warning.

# Rationale
- A background job (not N client requests) so the whole sweep shares one model load —
  the dominant cost — and reports unified progress.
- A parameter whitelist keeps an axis to a known, bounded, safely-coercible knob;
  arbitrary param sweeps would risk invalid pipeline kwargs.
- Reusing `services.jobs` + `BatchProgress` + `BatchImageResult` keeps the WS/progress/
  gallery/result wiring identical to the other image-op jobs.

# Consequences
- Capped at 64 cells; larger sweeps are rejected with a UI warning, not silently
  truncated.
- Adds no new heavy model service — it drives the existing generation pipe, so it is
  VRAM-coordinated by the single-job guard (ADR 0014) like every other job.
