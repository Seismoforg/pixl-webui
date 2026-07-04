"""In-process pub/sub hub so background producer threads can wake the WebSocket
pusher the instant job/download state changes, instead of it polling on a tick.

A subscriber (one open socket, per channel key) registers an ``asyncio.Queue``
together with the event loop that queue lives on. Producers — running on the
generation/upscale/download background threads — call :func:`publish` from any
thread; each subscribed queue is woken via ``loop.call_soon_threadsafe`` (the
thread→async bridge). A wake only means "state may have changed": the pusher
recomputes the current payload and keeps its own send-on-change dedup.

Keys are ``"generation:<job_id>"``, ``"upscale:<job_id>"`` and
``"download:<slug>"`` — the same identifiers ``routers/ws.py`` builds from client
subscribe messages. With no subscribers, :func:`publish` is a cheap no-op, so
producers can always call it unconditionally.
"""
from __future__ import annotations

import asyncio
import threading

# key -> subscriber queues, each paired with the loop it belongs to so we can wake
# it thread-safely. A single socket subscribed to N keys appears under N entries,
# all pointing at that socket's one queue.
_subscribers: dict[str, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}
_lock = threading.Lock()


def subscribe(key: str, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
    with _lock:
        _subscribers.setdefault(key, set()).add((loop, queue))


def unsubscribe(key: str, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
    with _lock:
        subs = _subscribers.get(key)
        if subs is None:
            return
        subs.discard((loop, queue))
        if not subs:
            del _subscribers[key]


def publish(key: str) -> None:
    """Wake every subscriber of ``key``. Safe to call from any thread."""
    with _lock:
        targets = list(_subscribers.get(key, ()))
    for loop, queue in targets:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, key)
        except RuntimeError:
            # Loop already closed (socket tearing down); the pending unsubscribe
            # will drop it. Nothing to deliver.
            pass
