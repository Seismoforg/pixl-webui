---
status: superseded by 0007
date: 2026-07-03
---

# Context
The frontend fetched all live data by polling REST endpoints on timers:
generation progress (~500 ms), upscale progress (~700 ms), system stats (~2 s)
and download progress (~1.5 s). Polling is laggy (bounded by the interval), noisy
in the server log, and wasteful of requests.

# Decision
Add one multiplexed **WebSocket** endpoint (`/ws`) that pushes live updates. The
client opens a single connection, subscribes per channel (`system`,
`generation`, `upscale`, `download`), and receives `{channel, key, data}` frames
where `data` is the exact same Pydantic model the REST endpoint returns. The
server sends a channel only when its serialised payload changes (send-on-change);
system stats are throttled to ~1 s and gathered off the event loop.

The REST endpoints are kept, and each consumer keeps a slow REST poll that only
runs while the socket is disconnected, so the app degrades gracefully.

# Rationale
- Lower latency (push instead of poll interval) over one persistent connection.
- Reusing the REST payload models means no new serialisation and the client keeps
  its existing types.
- Server-side push (a fast in-process tick reading existing job/stat state) needs
  no thread→async bridge, so it's simple and robust; the client-side win (no HTTP
  polling) is the same as a fully event-driven push.
- Keeping REST as a fallback means a WS failure never breaks live updates.

# Consequences
- A new backend transport (`routers/ws.py`) and a small reconnecting client
  (`lib/ws.ts` + `useLive`) to maintain.
- The server still reads state on a tick rather than being event-driven; latency
  is bounded by the tick (250 ms), not truly instantaneous. Good enough; can be
  upgraded to queue-based push later if needed.
- Two code paths (WS + REST fallback) exist for each live channel.
