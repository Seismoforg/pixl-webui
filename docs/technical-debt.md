# Technical Debt

## Download progress is polled, size-based  (added 2026-07-03)
- Problem: Download progress is derived by comparing on-disk bytes against the
  repo's total size and polled by the frontend, rather than streamed (SSE/WS).
- Impact: Progress can be slightly coarse/laggy; no per-file detail.
- Proposed Resolution: Switch to server-sent events with `huggingface_hub`
  progress callbacks once the MVP is stable.

## Single-model pipeline cache  (added 2026-07-03)
- Problem: Only one diffusers pipeline is kept in memory; switching models
  unloads the previous one.
- Impact: Frequent model switching re-loads weights from disk.
- Proposed Resolution: Optional LRU cache of N pipelines gated by available VRAM.

## Xet backend disabled on Windows  (added 2026-07-03)
- Problem: HuggingFace's Xet download backend (`hf_xet`) writes temp files under
  `.cache/huggingface/download/` whose names trigger `[WinError 123]` on Windows,
  so we force `HF_HUB_DISABLE_XET=1` in `config.py`.
- Impact: Downloads use the classic HTTPS path, which can be slower than Xet for
  Xet-backed repos (e.g. FLUX).
- Proposed Resolution: Re-enable Xet once the Windows path issue is fixed upstream
  in `hf_xet` / `huggingface_hub`.

## Secondary color fails WCAG AA on light backgrounds  (added 2026-07-03)
- Problem: The brand secondary `#ec4899` used as outlined-chip text/border
  (e.g. the pipeline-tag chip in ModelCard) contrasts only ~3.5:1 against the
  light-mode paper (`#ffffff`), below the WCAG AA 4.5:1 threshold for small text.
  It passes on the dark theme (~5:1). Primary was darkened to `#5457e0` to clear
  AA for the contained button; secondary was left as-is to preserve brand identity.
- Impact: Small pink chip labels are harder to read in light mode.
- Proposed Resolution: Either introduce a darker `secondary` shade specifically
  for on-light text, or restyle those chips to use `text.primary` with a colored
  border only.

## WebSocket push is tick-based, not event-driven  (added 2026-07-04)
- Problem: `backend/app/routers/ws.py` pushes live progress on a 250ms tick
  (send-on-change) rather than truly event-driven queue-based push. Latency is
  bounded by the tick, as noted in ADR 0005.
- Impact: Progress updates can lag up to ~250ms. Negligible for a local,
  single-user app.
- Proposed Resolution: Tracked as a separate feature
  (`features/draft/20260704-2003-websocket-queue-based-push.md`): a per-job
  asyncio.Queue/pub-sub with a thread→async bridge, superseding ADR 0005. Deferred
  because the user-visible gain is small and it reintroduces the thread bridge the
  ADR deliberately avoided.

## Frontend rebuilds on every launch  (added 2026-07-04)
- Problem: `start.bat` runs `npm run build && npm run start` so it always serves a
  production build (dev mode caused 1-2s on-demand route compiles). The build is
  incremental (reuses `.next/cache`) but still runs each launch rather than being
  produced once at install time.
- Impact: First launch after a change has a short build delay before the frontend
  is reachable; the browser auto-open (6s) may briefly precede readiness on the
  first/cold build.
- Proposed Resolution: Optionally move `npm run build` into `install.ps1` and have
  `start.bat` run only `next start`, rebuilding on demand.

## AMD gfx-arch mapping is static  (added 2026-07-03)
- Problem: The AMD GPU → gfx architecture mapping in `install.ps1` is hardcoded
  from the current rocm-torch-windows support list.
- Impact: New AMD GPUs need a manual mapping update.
- Proposed Resolution: Delegate arch detection to rocm-torch-windows where
  possible, or fetch the mapping from it.
