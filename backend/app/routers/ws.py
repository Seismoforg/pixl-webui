"""Multiplexed WebSocket for live updates (replaces client HTTP polling).

One connection at ``/ws`` carries several channels. The client subscribes with
JSON messages and the server pushes ``{channel, key, data}`` frames, sending a
channel only when its serialised payload changes (send-on-change). Payloads are
the exact same models the REST endpoints return, so the client can reuse its
types — and the REST endpoints stay as a fallback.

Push is event-driven: producers (generation/upscale step callbacks, downloader
state transitions) call ``live.publish(key)`` from their background threads, which
wakes this connection's queue (see :mod:`app.live`); the pusher then recomputes
and sends. Two channels can't be event-driven and stay on a short periodic tick:
``system`` stats (psutil sampling is inherently periodic) and ``download`` byte
progress (read from on-disk file size, which no producer emits an event for —
only download *status* transitions are published).

Channels:
- ``system``     — resource stats (periodic ~1s tick)
- ``generation`` — a generation job's progress (``job_id``, event-driven)
- ``upscale``    — an upscale job's progress (``job_id``, event-driven)
- ``download``   — a model/upscaler download's progress (``slug``; status
  event-driven, byte progress on the periodic tick)
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from .. import live
from ..services import downloader, resources
from . import generate, upscale

router = APIRouter()

_POLL = 0.5          # seconds between periodic passes for sampled channels
_SYSTEM_EVERY = 2    # push system stats every N periodic passes (~1s)

# Channels that get producer-published wakes via the pub/sub hub (system is purely
# tick-driven and never published).
_PUBLISHED = ("generation", "upscale", "download")
# Channels whose payload changes without a producer event, so the periodic tick
# must keep re-reading them (download = growing on-disk bytes; system = psutil).
_SAMPLED = ("system", "download")


def _channel_data(desc: dict) -> dict | None:
    """Current payload for a subscription descriptor, or None to skip this pass."""
    channel = desc["channel"]
    try:
        if channel == "generation":
            return generate.generation_progress(desc["job_id"]).model_dump()
        if channel == "upscale":
            return upscale.upscale_progress(desc["job_id"]).model_dump()
        if channel == "download":
            return downloader.get_progress(desc["slug"]).model_dump()
    except HTTPException:
        return None
    return None


def _key(msg: dict) -> tuple[str, dict] | None:
    """Build the subscription key + descriptor from a client message."""
    channel = msg.get("channel")
    if channel == "system":
        return "system", {"channel": "system"}
    if channel in ("generation", "upscale"):
        job_id = msg.get("job_id")
        if not job_id:
            return None
        return f"{channel}:{job_id}", {"channel": channel, "job_id": job_id}
    if channel == "download":
        slug = msg.get("slug")
        if not slug:
            return None
        return f"download:{slug}", {"channel": channel, "slug": slug}
    return None


@router.websocket("/ws")
async def live_updates(websocket: WebSocket) -> None:
    await websocket.accept()
    loop = asyncio.get_running_loop()
    subs: dict[str, dict] = {}
    last: dict[str, str] = {}
    # Wakes to (re)send a key: producer publishes, the periodic ticker, and the
    # initial send on subscribe all enqueue here; the pusher drains it.
    queue: asyncio.Queue[str] = asyncio.Queue()

    async def receiver() -> None:
        while True:
            msg = await websocket.receive_json()
            built = _key(msg)
            if built is None:
                continue
            key, desc = built
            action = msg.get("action")
            if action == "subscribe":
                if key in subs:
                    continue
                subs[key] = desc
                if desc["channel"] in _PUBLISHED:
                    live.subscribe(key, loop, queue)
                queue.put_nowait(key)  # send current state immediately
            elif action == "unsubscribe":
                if subs.pop(key, None) is not None and desc["channel"] in _PUBLISHED:
                    live.unsubscribe(key, loop, queue)
                last.pop(key, None)

    async def ticker() -> None:
        # system stats + download byte-progress are inherently sampled (psutil /
        # on-disk size), so refresh those subscriptions on a periodic pass.
        tick = 0
        while True:
            await asyncio.sleep(_POLL)
            tick += 1
            for key, desc in list(subs.items()):
                channel = desc["channel"]
                if channel == "system" and tick % _SYSTEM_EVERY != 0:
                    continue
                if channel in _SAMPLED:
                    queue.put_nowait(key)

    async def pusher() -> None:
        while True:
            key = await queue.get()
            desc = subs.get(key)
            if desc is None:  # unsubscribed before we got to it
                continue
            if desc["channel"] == "system":
                data = (await asyncio.to_thread(resources.get_stats)).model_dump()
            elif desc["channel"] == "download":
                # Download progress reads on-disk byte size (a directory walk); keep
                # it off the event loop so a large download can't block the pusher.
                data = await asyncio.to_thread(_channel_data, desc)
            else:
                data = _channel_data(desc)
            if data is None:
                continue
            payload = json.dumps({"channel": desc["channel"], "key": key, "data": data})
            if last.get(key) == payload:
                continue
            last[key] = payload
            await websocket.send_text(payload)

    tasks = [asyncio.create_task(t()) for t in (receiver, ticker, pusher)]
    try:
        await asyncio.gather(*tasks)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - a broken socket just ends the session
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for key, desc in subs.items():
            if desc["channel"] in _PUBLISHED:
                live.unsubscribe(key, loop, queue)
