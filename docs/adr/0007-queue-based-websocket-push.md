---
status: accepted
date: 2026-07-04
---

# Context
ADR 0005 introduced the `/ws` multiplexed WebSocket but pushed on a fixed 250 ms
tick: `pusher()` woke every tick, read in-memory job/download state and sent
on-change. That deliberately avoided a thread→async bridge (producers run on
background threads; the socket on the event loop), at the cost of progress latency
bounded by the tick. ADR 0005 flagged this as upgradable to queue-based push later.

# Decision
Make the push **event-driven** for the `generation` and `upscale` channels (and
`download` status transitions):

- A small in-process pub/sub hub (`app/live.py`) keys subscribers by
  `generation:<job>` / `upscale:<job>` / `download:<slug>`, each an `asyncio.Queue`
  paired with the event loop it lives on.
- Producers — the diffusers step callbacks, the upscale/outpaint step reports and
  the downloader state transitions — call `live.publish(key)` from their background
  threads. `publish` wakes each subscribed queue via `loop.call_soon_threadsafe`
  (the thread→async bridge ADR 0005 avoided).
- `pusher()` awaits its queue instead of sleeping. A wake only means "state may have
  changed"; it recomputes the current payload and keeps the send-on-change dedup, so
  the wire frames (`{channel, key, data}`) and payload models are unchanged.

Two channels can't be event-driven and stay on a short periodic tick (~0.5 s pass;
system sampled every 2nd pass ≈ 1 s):
- `system` — psutil sampling is inherently periodic.
- `download` **byte** progress — read from on-disk file size, which no producer
  emits an event for; only download *status* transitions (start / done / error) are
  published for instant feedback.

# Rationale
- Progress reaches the client with no tick latency, the win ADR 0005 deferred.
- Reusing the REST payload models and the same wire frames means zero client change
  and the REST fallback still works — a WS or bridge failure never breaks updates.
- The thread→async bridge is confined to one tiny module (`live.py`) and is
  best-effort: `publish` is a no-op with no subscribers and swallows the race where
  a socket's loop is already tearing down, so producers call it unconditionally.
- A queue-blocked pusher can't self-terminate the way the old sleep loop did, so the
  connection now explicitly cancels its tasks and unsubscribes on disconnect.

# Consequences
- New `app/live.py` (pub/sub hub) and `publish` calls in `routers/generate.py`,
  `routers/upscale.py` and `services/downloader.py`.
- Reintroduces a thread→async bridge — the one thing ADR 0005 chose to avoid — but
  contained and guarded; this ADR supersedes 0005.
- `download` byte progress and `system` stats remain sampled (not truly
  event-driven), which is inherent to how those values are produced.
