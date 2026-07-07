# Pixl WebUI

A lightweight, modern WebUI for running Stable Diffusion / image generation models.

- **Frontend:** Next.js + React + TypeScript + MUI (Emotion `sx`)
- **Backend:** Python (FastAPI) with HuggingFace `diffusers` as the inference engine
- **Platform:** Windows (NVIDIA via CUDA, AMD via [rocm-torch-windows](https://github.com/Seismoforg/rocm-torch-windows))

Models are selected in the UI and downloaded into a project-local `models/` folder
(no global HuggingFace cache). An optional HuggingFace token can be stored in the
settings to speed up downloads and access gated models.

## Requirements

- Windows 10/11
- Python 3.10 – 3.13 (on `PATH`)
- Node.js 18+ (on `PATH`)
- A supported GPU (NVIDIA, or AMD per the rocm-torch-windows compatibility list) — CPU works but is slow

## Install

```powershell
.\install.ps1
```

The installer detects your GPU and installs the matching PyTorch build:

- **NVIDIA** → PyTorch CUDA wheels into `.venv`
- **AMD** → ROCm PyTorch via `rocm-torch-windows` into `.venv`

then installs the backend and frontend dependencies. Re-run with `-Force` to rebuild.

## Run

```powershell
.\start.bat
```

Starts the backend (http://localhost:8000) and the frontend (http://localhost:3000)
and opens the browser.

## Project structure

```
pixl-webui/
  install.ps1        Installer (GPU detection, PyTorch, deps)
  start.bat          Starts backend + frontend
  test-frontend.bat  Playwright inspect harness (backend + frontend dev + shared browser)
  backend/        FastAPI + diffusers inference backend
  frontend/       Next.js + MUI frontend
  docs/           Architecture docs and ADRs
  models/         Downloaded models (git-ignored)
  data/           Local settings incl. HF token (git-ignored)
```

## Frontend inspection (Playwright)

For UI/UX work, `test-frontend.bat` is a one-click launcher: it starts the backend and
the frontend **dev server** (live reload), then opens a shared browser you drive. The
assistant attaches over CDP to inspect the active page — screenshot plus exact element
metrics (box model, computed styles) and accessibility.

```powershell
.\test-frontend.bat
```

Prepare any state in the window, then ask the assistant to inspect (e.g. a selector on
the current page). See [frontend/e2e/](frontend/e2e/) for details.

See [docs/](docs/) for architecture and decision records.
