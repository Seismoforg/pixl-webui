# Purpose
Backend-communication infrastructure and small pure helpers shared across the UI.

# Responsibilities
- Expose a typed REST client for the FastAPI backend
- Expose a reconnecting, multiplexed WebSocket client + `useLive` hook
- Provide small pure view helpers (GPU-fit mapping, upscale status derivation,
  reframe geometry, inpaint mask-overlay math)

# File Structure
- api.ts    — typed backend client (REST); one `request<T>` core + per-endpoint
              methods. Exports `API_BASE` (`NEXT_PUBLIC_API_BASE`, default :8000),
              the single backend origin reused by ws.ts
- ws.ts     — module-level singleton `live` (reconnecting, multiplexed) + `useLive`:
              subscribes a channel and falls back to REST polling while the socket
              is down. Used for generation/upscale progress, system stats, downloads.
              `useJobTracker` wraps subscribe + poll-fallback for a single running
              job (shared by the generation, upscale, reframe, inpaint & edit providers)
- fit.ts    — maps a GPU-fit verdict to a chip color + locale keys
- formLock.ts — `formLockStyle(locked)`: reset-styled fieldset style that dims + locks
              a form's controls while a job runs (shared by all 5 feature forms)
- reframe.ts— pure reframe geometry mirroring the backend (parseRatio / extendSize
              / coverRect + maskFeatherPx / seamFeatherPx softness→feather helpers)
              + the canvas draw helpers (drawCover / drawExtend / drawFeatherBand)
              extracted from ReframePreview; drives the client-side ReframePreview
              (incl. the outpaint gradient overlay) so it matches the server without
              a generation run
- modelFamily.ts — pure model-family capability checks (supportsStyleTransfer /
              supportsSamplerChoice) keyed by family (SD 1.5 / SDXL / FLUX / SD 3.x)
- objectPath.ts — generic dotted-path get/set (getPath/setPath + Draft type) for
              the declarative CatalogEditor
- jobHooks.ts — shared job-lifecycle hooks used by the 5 feature providers:
              `useJobRehydrate` (re-attach a still-running job after reload) and
              `usePublishJobActivity` (publish the running job to the activity store;
              Upscale/Reframe/Inpaint/Edit — Generation keeps its own phase-text effect)
- useEngineCatalog.ts / useImageSource.ts — shared panel hooks: engine-catalog fetch
              (`{engines, loading, error, reload}`, error distinct from empty) and the
              deep-link source preselect + gallery-metadata fetch (used by the 4 panels)
- useInpaintEngineSelection.ts — inpaint-kind engine selection + download lifecycle
              shared by the reframe (outpaint) + inpaint panels: filter to inpaint
              engines, resolve the selected one, load+pick the Settings default, apply
              the engine's tuned defaults (panel-specific via `onEngineDefaults`), track
              its download; returns `{inpaintEngines, selectedEngine, flowMatch, ...,
              error, setError}`
- useSnippets.ts — load the prompt-snippet list + `reloadSnippets` (reframe/inpaint)
- readFile.ts — `readFileAsDataUrl(file)`: File/Blob → base64 data URL (every upload
              handler + the reference-image picker)
- useImageRouteParams.ts — parses the `?image=` deep-link + gallery reload token from
              the shared route glue (upscale/reframe/inpaint/edit pages; call inside Suspense)
- inpaint.ts— inpaint feather math (reuses maskFeatherPx/seamFeatherPx + seedBlurPx)
              + `renderOverlay` (composites the mask-gradient / composite-seam /
              seed-blur layers onto the InpaintCanvas overlay so the feather sliders
              show live) + `maskHasContent` / `maskToDataUrl` (flatten the alpha-keyed
              mask onto black for export); mirrors the backend inpaint service
- stats.ts  — derives the upscale/reframe/inpaint/edit status line + percent (same
              progress shape) shared by the frame/overlay
- useAsyncData.ts — hook wrapping a mount/deps-driven fetch into
              `{ data, loading, error, reload }` (last-request-wins, no state set
              after unmount); the shared loading/error lifecycle for read-only fetches
- jobPersistence.ts — localStorage-backed persistence of in-flight work
              (`loadJob`/`saveJob`/`clearJob` for the generation/upscale/reframe/
              inpaint job ids + `loadDownloads`/`saveDownloads` for tracked
              downloads) so status
              bubbles survive a full page reload. SSR-guarded + best-effort; the
              providers rehydrate from it on mount

# Key Components
- api — the single typed entry point for all REST calls
- live / useLive — the single WebSocket client; providers subscribe through it

# Dependencies
react, @/types (response types). No UI/MUI dependency (fit.ts returns tokens/keys,
not components).

# Related Modules
- Parent: ../../ (frontend)
- Consumed by: ../providers (data + progress), ../components (fit/stats helpers)
