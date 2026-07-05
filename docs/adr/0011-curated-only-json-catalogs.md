---
status: accepted
date: 2026-07-05
---

# Context
Models and engines were each offered two ways: a hardcoded curated Python list
(`catalog.CATALOG`, `upscalers.UPSCALERS`) and a free-form HuggingFace browser that
resolved arbitrary repos into "custom" entries, persisted in
`data/custom_models.json` / `data/custom_upscalers.json`. The browsers carried a lot
of surface — HF search/resolve UIs (`AddModelDialog`, `AddEngineDialog`), the
`hf_browse` service (list_models + repo/engine resolve + diffusers-compatibility +
VRAM estimation), search/resolve/add endpoints, two custom stores, and a
`curated`/`custom` split threaded through the API and UI.

Two problems drove this change:
- The curated lists lived in Python source, so a downstream user of the repo could
  not fix a broken community entry (a repo id that changed, a model that became
  gated, a size correction) without editing code.
- The browser workflow (add any HuggingFace repo) was no longer wanted; the app
  should offer a curated, maintainable set only.

# Decision
Remove both browsers and both custom stores. Make each curated list **JSON-backed**
and **editable in Settings** via a structured form:
- `backend/app/models_catalog.json` and `backend/app/engines_catalog.json` are the
  bundled defaults (checked in).
- A git-ignored override in `data/` (`data/models_catalog.json`,
  `data/engines_catalog.json`) fully replaces the default when present; an invalid
  override silently falls back to the bundled default so the app never fails to
  start.
- `catalog.py` / `services/upscalers.py` expose `default_catalog` / `load_catalog` /
  `save_catalog` / `reset_catalog`. New CRUD endpoints
  (`GET/PUT /api/models/catalog` + `.../reset`, and the `/api/upscale/engines/catalog`
  equivalents) back the Settings editors.
- The frontend gains one reusable `CatalogEditor` organism (driven by a declarative
  `FieldSpec[]`) with two thin wrappers, `CuratedModelsEditor` and
  `CuratedEnginesEditor`.
- `hf_browse.py`, `custom_models.py`, `custom_upscalers.py`, `AddModelDialog.tsx`
  and `AddEngineDialog.tsx` are deleted; the `curated` flag is dropped from the model
  and engine API responses.

# Rationale
- A checked-in default plus a `data/` override is the standard "ship a default, let
  the operator fix it" pattern, and mirrors how settings/prompt-templates already
  persist. Reset-to-defaults is just deleting the override.
- JSON is the natural edit format for a small, structured list, and pydantic
  (`ModelInfo` / `UpscalerInfo`) already validates it on load and save.
- A single generic `CatalogEditor` avoids duplicating the list/dialog/CRUD
  scaffolding across the two entities while keeping each entity's field set
  declarative and small.
- Deleting the browsers removes a large, rarely-needed surface (HF search/resolve,
  compatibility heuristics, two stores) that we no longer want to maintain.

# Consequences
- Breaking API changes: `GET /api/models/search|resolve`, `POST /api/models`,
  `GET /api/upscale/engines/resolve` and `POST /api/upscale/engines` are removed;
  `/api/models/catalog` and `/api/upscale/engines/catalog` CRUD are added; `curated`
  is gone from model + engine responses.
- Existing `data/custom_models.json` / `data/custom_upscalers.json` files are ignored
  (no migration) — previously custom-added entries disappear and must be re-added via
  the editor.
- Removing a catalog entry that was already downloaded leaves its files orphaned in
  `models/<slug>` (see technical-debt). Editing to a bad repo id surfaces only at
  download time.
- The catalogs are read from disk per lookup/list (small files, low frequency) — no
  caching, so edits take effect immediately.
