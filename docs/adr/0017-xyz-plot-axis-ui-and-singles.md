---
status: accepted
date: 2026-07-07
---

# Context
Extends ADR 0016 (XYZ-plot compare). The v1 axis editor typed values comma-separated
in one field, only swept steps/guidance/sampler/seed, showed the (inert) sampler on
flow-matching families, and saved only the composed grid sheet. Users wanted a proper
per-value UI, prompt sweeps, and access to each cell image.

# Decision
- **Per-value axis UI** — `AxisEditor` renders one row per value with the right control
  (number / sampler dropdown / positive+negative prompt pair) + an add/remove button;
  no more comma parsing.
- **Prompt sweep axis** — new whitelist param `prompt`; each value = `{prompt, negative}`
  pair, applied as `prompt` + `negative_prompt` overrides per cell; grid label = the
  positive prompt truncated to 24 chars.
- **Sampler gating** — base sampler control + `sampler` axis hidden for flow-matching
  families (FLUX / SD 3.x), where the sampler is inert (mirrors the generate form).
- **Save individuals** — `save_individuals` (default on) also persists every cell image
  to the gallery with its effective metadata; the grid sheet(s) stay the compare result.
- **Base params** restyled to the shared slider look (steps/guidance).

# Rationale
- Right control per value type removes parse ambiguity and validates inline.
- Prompt is still a known, bounded pipeline kwarg pair — fits 0016's whitelist rule.
- Cell images already exist in memory; saving them costs one `gallery.save` per cell and
  makes each result reachable by the regenerate/upscale/gallery flows.
- Reuses 0016's job/grid/gallery/progress wiring unchanged.

# Consequences
- A full 64-cell sweep with `save_individuals` writes up to 64 extra gallery files;
  opt-out via the toggle.
- Prompt-axis values are unbounded text (unlike numeric knobs); validated only as
  non-empty, coerced to a `{prompt, negative}` dict.
