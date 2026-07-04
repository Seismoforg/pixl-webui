# Purpose
Root of Pixl WebUI — a lightweight WebUI for running image-generation (Stable
Diffusion family) models on Windows, with a Next.js frontend and a Python
(FastAPI + diffusers) inference backend.

# Responsibilities
- Provide the Windows installer (`install.ps1`) with GPU-aware PyTorch setup
- Provide the start script (`start.bat`) that launches backend + frontend
- Host the two application modules (`backend/`, `frontend/`) and docs

# File Structure
- install.ps1        — GPU detection + PyTorch (CUDA/ROCm) + dependency install
- start.bat          — starts backend (uvicorn) and frontend (next) together
- backend/           — FastAPI + diffusers inference API
- frontend/          — Next.js + MUI UI
- docs/              — ADRs and technical debt
- models/            — project-local model downloads (git-ignored)
- data/              — local settings incl. HF token (git-ignored)

# Key Components
- install.ps1 — the only supported way to set up the Python environment
- start.bat   — the standard entry point after install

# Dependencies
Python 3.10–3.13, Node.js 18+, PyTorch (CUDA or ROCm), diffusers, Next.js, MUI.

# Related Modules
- Child: ./backend  (inference API)
- Child: ./frontend (web UI)

# Decisions
Architecture Decision Records live in ./docs/adr (an ADR log, not a module).
Technical debt is tracked in ./docs/technical-debt.md.
