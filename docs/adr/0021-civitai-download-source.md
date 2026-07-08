---
status: accepted
date: 2026-07-08
---

# Context
Many FLUX.2 klein (and other) LoRAs/checkpoints live only on **civitai.com**, not on
HuggingFace. Downloads so far assumed an HF repo (`snapshot_download` / single-file HF).
A second source with its own API-key auth was needed.

# Decision
Add Civitai as a second download source alongside HuggingFace.

- New `civitai_token` setting (persisted in git-ignored `data/settings.json`, like
  `hf_token`).
- `downloader.start_civitai_download` streams one Civitai **version file** from
  `/api/download/models/{version_id}` with `Authorization: Bearer <civitai_token>`,
  into `models/<slug>` — reusing the shared size-based progress state. 401/403 →
  `CIVITAI_AUTH_REQUIRED`.
- `LoraInfo` carries an optional `civitai_version_id`; `repo_id` stays `""` for a
  Civitai entry (documented empty-string sentinel). `routers/loras.py` branches on
  `civitai_version_id` to pick the Civitai path vs the HF single-file path.
- Uses `requests` for the stream (now a declared dep).

# Rationale
- Reuses the existing download/progress/delete plumbing — only the fetch differs.
- Version-id + token is Civitai's documented direct-download contract.
- Keeping `repo_id` typed `str` (empty for Civitai) avoids an Optional ripple through the
  HF download helpers.

# Consequences
- Untested against the live Civitai API (needs a real key) — first real download may hit
  edge cases: redirects, rate limits, missing `Content-Length` → no progress total
  (technical-debt).
- No size pre-fetch; progress total comes only from `Content-Length`.
- Curated Civitai entries pin a `civitai_version_id` that can be moved/removed upstream
  (same class of risk as the pinned HF/GGUF entries).

# Related
- ADR 0011 (curated-only JSON catalogs), ADR 0015 (LoRA adapters), ADR 0020 (FLUX.2 klein)
