# Purpose
Backend-communication infrastructure and small pure helpers shared across the UI.

# Responsibilities
- Expose a typed REST client for the FastAPI backend
- Expose a reconnecting, multiplexed WebSocket client + `useLive` hook
- Provide small pure view helpers (GPU-fit mapping, upscale status derivation)

# File Structure
- api.ts    — typed backend client (REST); one `request<T>` core + per-endpoint
              methods. Base URL from `NEXT_PUBLIC_API_BASE` (default :8000)
- ws.ts     — module-level singleton `live` (reconnecting, multiplexed) + `useLive`:
              subscribes a channel and falls back to REST polling while the socket
              is down. Used for generation/upscale progress, system stats, downloads.
              `useJobTracker` wraps subscribe + poll-fallback for a single running
              job (shared by the generation, upscale & reframe providers)
- fit.ts    — maps a GPU-fit verdict to a chip color + locale keys
- stats.ts  — derives the upscale/reframe status line + percent (same progress
              shape) shared by the frame/overlay
- useAsyncData.ts — hook wrapping a mount/deps-driven fetch into
              `{ data, loading, error, reload }` (last-request-wins, no state set
              after unmount); the shared loading/error lifecycle for read-only fetches

# Key Components
- api — the single typed entry point for all REST calls
- live / useLive — the single WebSocket client; providers subscribe through it

# Dependencies
react, @/types (response types). No UI/MUI dependency (fit.ts returns tokens/keys,
not components).

# Related Modules
- Parent: ../  (frontend/src, via ../../AGENTS.md)
- Consumed by: ../providers (data + progress), ../components (fit/stats helpers)
