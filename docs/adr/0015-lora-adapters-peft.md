---
status: accepted
date: 2026-07-07
---

# Context
Users want to bias a base model toward a style/subject/concept without downloading a
full fine-tuned checkpoint. LoRA adapters are small (~10-200 MB) `.safetensors` weight
files layered onto an existing base pipe at generation time. They are family-scoped
(an SDXL LoRA only applies to an SDXL base) and several can blend at once with
per-adapter weights. Needs a new runtime dependency (`peft`, the diffusers PEFT
backend for `load_lora_weights`/`set_adapters`).

# Decision
- **Catalog** `services/loras.py` + `loras_catalog.json` — JSON-backed like the model/
  engine catalogs (bundled default + git-ignored `data/loras_catalog.json` override,
  edited in Settings). `LoraInfo`: slug/repo_id/filename/name/family/trigger/size.
- **Download** reuses the single-file machinery (`downloader.start_file_download`) into
  `models/<slug>` — no new download path. `routers/loras.py`: GET `/api/loras`,
  catalog GET/PUT/reset, POST `/{slug}/download` + progress + DELETE.
- **Apply at generation time** (NOT a job of its own): `pipeline._apply_loras(pipe,
  model, [(slug, weight)])` loads each requested adapter (`load_lora_weights`,
  `adapter_name=slug`) and blends via `set_adapters(names, weights)`. Tracked in
  `_loaded_loras`; skipped when the request matches what's already resident;
  `_ensure_no_loras` unloads for a plain run. Family mismatch → error.
- **LCM sampler** (`samplers.py`): `LCMScheduler` allowed on UNet models (SD 1.5/SDXL)
  for the LCM-LoRA few-step (~4-8 steps, low guidance) recipe, even though LCM isn't in
  diffusers' `compatibles`.
- **Frontend** `LoraPicker` organism on `/generate` + selection in `GenerationProvider`
  (`loras: LoraRef[]`): lists LoRAs matching the selected model family, enable +
  blend-weight each, inline download, one-tap trigger words into the prompt; prunes
  incompatible picks on model-family change.

# Rationale
- A separate catalog (not model entries) keeps LoRAs out of the text-to-image model
  manager while reusing catalog/download/override machinery.
- Applied on the base pipe at generate time (not a distinct pipeline/service) because a
  LoRA modifies an existing model — no VRAM coordination beyond the base pipe.
- `peft` is diffusers' supported multi-adapter blend backend; hand-rolling weight
  merges would be fragile.

# Consequences
- New runtime dep `peft` (added to pyproject + install.ps1).
- LoRA state lives on the base pipe; `reset_derived` clears `_loaded_loras` when the
  base pipe drops, so a model swap forgets stale adapters.
- Family scoping is enforced at apply time; a UI-side prune keeps the picker honest.
