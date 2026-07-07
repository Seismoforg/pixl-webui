# Purpose
Root of Pixl WebUI — a lightweight WebUI for running image-generation (Stable
Diffusion family) models on Windows, with a Next.js frontend and a Python
(FastAPI + diffusers) inference backend.

# Responsibilities
- Provide the Windows installer (`install.ps1`) with GPU-aware PyTorch setup
- Provide the start script (`start.bat`) that launches backend + frontend
- Host the two application modules (`backend/`, `frontend/`) and docs

# File Structure
- install.ps1        — GPU detection + PyTorch (CUDA/ROCm) + dependency install;
                       provisions a pinned project-local Python into `.python\` when no
                       suitable system Python (3.10-3.13) is found (system Python untouched)
- start.bat          — starts backend (uvicorn) and frontend (next) together
- test-frontend.bat  — one-click Playwright inspect harness: starts backend + frontend
                       DEV server + a shared browser you drive; Claude attaches over CDP
                       to inspect the UI (frontend/e2e)
- backend/           — FastAPI + diffusers inference API
- frontend/          — Next.js + MUI UI
- docs/              — ADRs and technical debt
- models/            — project-local model downloads (git-ignored)
- data/              — local settings incl. HF token (git-ignored)

# Key Components
- install.ps1 — the only supported way to set up the Python environment
- start.bat   — the standard entry point after install
- test-frontend.bat — Playwright inspect harness for UI/UX work (see frontend/e2e)

# Dependencies
Python 3.10–3.13 (auto-provisioned into `.python\` from python-build-standalone if not
found), Node.js 18+, PyTorch (CUDA or ROCm), diffusers, Next.js, MUI.
AMD/ROCm install is delegated to the `rocm-torch-windows` module, fetched from
GitHub at install time (pinned commit) — see docs/adr/0018. Needs network reach
to github.com at install.

# Related Modules
- Child: ./backend  (inference API)
- Child: ./frontend (web UI)

# Decisions
Architecture Decision Records live in ./docs/adr (an ADR log, not a module).
Technical debt is tracked in ./docs/technical-debt.md.
