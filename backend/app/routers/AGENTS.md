# Purpose
HTTP controller layer for the backend. Each module is a FastAPI `APIRouter`
registered in `app/main.py`. Controllers only validate/parse requests, dispatch to
`../services`, and shape responses — no business logic (ADR: layered arch).

# Responsibilities
- Define request/response Pydantic schemas + route handlers
- Start background jobs via the `services/jobs.py` kernel (`start_job` spawn +
  `job_run` tail + `run_batch` loop; `jobs.JobBusy` → 409 handled app-wide in main.py)
- Map service errors to HTTP status codes; publish WS wakes via `app/live.py`

# File Structure
One module per concern (routes under the noted prefix):
- system.py    — /api/system (device + live resource stats)
- settings.py  — /api/settings (HF/Civitai token, perf toggles)
- models.py    — /api/models (catalog, download, fit, delete)
- loras.py     — /api/loras (catalog, download HF/Civitai, delete)
- generate.py  — /api/generate (text-to-image job + /api/samplers)
- compare.py   — /api/compare (XYZ-plot sweep job)
- images.py    — /api/images (gallery list/get/file/delete/bulk-delete)
- templates.py — /api/prompt-templates (snippet CRUD)
- upscale.py   — /api/upscale (engines + upscale job); shared UpscaleProgress/BatchProgress
- reframe.py   — /api/reframe (aspect reframe / outpaint job)
- inpaint.py   — /api/inpaint (user-mask inpaint job)
- edit.py      — /api/edit (prompt edit job)
- restore.py   — /api/restore (analysis-driven photo-restoration job; + /presets +
                 /engines; ADR 0024)
- ws.py        — /ws (multiplexed WebSocket push)

Per-endpoint request/response detail: see `../../AGENTS.md` Key Components (kept there
to avoid drift — do not duplicate here).

# Dependencies
fastapi, pydantic; dispatches to `../services`; shared job infra in `services/jobs.py`,
single-job guard in `services/job_guard.py` (ADR 0014).

# Related Modules
- Parent: ../../ (backend)
- Peer: ../services (business logic this layer dispatches to)
