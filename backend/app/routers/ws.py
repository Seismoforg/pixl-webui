"""Multiplexed WebSocket for live updates (replaces client HTTP polling).

One connection at ``/ws`` carries several channels. The client subscribes with
JSON messages and the server pushes ``{channel, key, data}`` frames, sending a
channel only when its serialised payload changes (send-on-change). Payloads are
the exact same models the REST endpoints return, so the client can reuse its
types — and the REST endpoints stay as a fallback.

Channels:
- ``system``     — resource stats (throttled to ~1s)
- ``generation`` — a generation job's progress (``job_id``)
- ``upscale``    — an upscale job's progress (``job_id``)
- ``download``   — a model/upscaler download's progress (``slug``)
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from ..services import downloader, resources
from . import generate, upscale

router = APIRouter()

_TICK = 0.25        # seconds between push passes for job/download channels
_SYSTEM_EVERY = 4   # push system stats every N ticks (~1s)


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
    subs: dict[str, dict] = {}
    last: dict[str, str] = {}

    async def receiver() -> None:
        while True:
            msg = await websocket.receive_json()
            built = _key(msg)
            if built is None:
                continue
            key, desc = built
            if msg.get("action") == "subscribe":
                subs[key] = desc
            elif msg.get("action") == "unsubscribe":
                subs.pop(key, None)
                last.pop(key, None)

    async def pusher() -> None:
        tick = 0
        while True:
            await asyncio.sleep(_TICK)
            tick += 1
            for key, desc in list(subs.items()):
                if desc["channel"] == "system":
                    if tick % _SYSTEM_EVERY != 0:
                        continue
                    data = (await asyncio.to_thread(resources.get_stats)).model_dump()
                else:
                    data = _channel_data(desc)
                if data is None:
                    continue
                payload = json.dumps({"channel": desc["channel"], "key": key, "data": data})
                if last.get(key) == payload:
                    continue
                last[key] = payload
                await websocket.send_text(payload)

    try:
        await asyncio.gather(receiver(), pusher())
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - a broken socket just ends the session
        pass
