# Purpose
Backend-communication infrastructure and small pure helpers shared across the UI.

# Responsibilities
- Expose a typed REST client for the FastAPI backend
- Expose a reconnecting, multiplexed WebSocket client + `useLive` hook
- Provide small pure view helpers (GPU-fit mapping, upscale status derivation,
  reframe geometry, inpaint mask-overlay math)

# File Structure
- api.ts    — typed backend client (REST); one `request<T>` core + per-endpoint
              methods. Base URL from `NEXT_PUBLIC_API_BASE` (default :8000)
- ws.ts     — module-level singleton `live` (reconnecting, multiplexed) + `useLive`:
              subscribes a channel and falls back to REST polling while the socket
              is down. Used for generation/upscale progress, system stats, downloads.
              `useJobTracker` wraps subscribe + poll-fallback for a single running
              job (shared by the generation, upscale, reframe, inpaint & edit providers)
- fit.ts    — maps a GPU-fit verdict to a chip color + locale keys
- formLock.ts — `formLockStyle(locked)`: reset-styled fieldset style that dims + locks
              a form's controls while a job runs (shared by all 5 feature forms)
- reframe.ts— pure reframe geometry mirroring the backend (parseRatio / extendSize
              / coverRect + maskFeatherPx / seamFeatherPx softness→feather helpers);
              drives the client-side ReframePreview (incl. the outpaint gradient
              overlay) so it matches the server without a generation run
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
