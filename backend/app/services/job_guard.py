"""Process-wide single-heavy-job guard.

The generation, upscale, reframe, inpaint and edit routers each run one background
job at a time in their OWN store — but they all contend for the SAME GPU, and the
model services coordinate VRAM by unloading each other on load. If two *different*
job types start at once, those mutual unloads interleave and both heavy pipes can end
up resident → OOM. This module enforces the invariant the VRAM design assumes: at
most one heavy job (of any type) runs across the whole process.

Each job router acquires on start (rejecting the request when another job is already
running) and releases in its ``_run`` ``finally``.
"""
from __future__ import annotations

import threading

_lock = threading.Lock()
_active: dict[str, str] = {}  # job_id -> kind ("generation" | "upscale" | ...)


def acquire(job_id: str, kind: str) -> str | None:
    """Register ``job_id`` as the active job. Returns ``None`` on success, or the kind
    of the job already running (leaving it untouched) when one is active — atomic under
    the lock, so two concurrent starts can never both win."""
    with _lock:
        if _active:
            return next(iter(_active.values()))
        _active[job_id] = kind
        return None


def release(job_id: str) -> None:
    """Drop ``job_id`` from the active set (a no-op if it was never registered)."""
    with _lock:
        _active.pop(job_id, None)
