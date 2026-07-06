"""Process-wide single-heavy-job guard. See ADR 0014.

One GPU; the model services coordinate VRAM by mutual unload-on-load. Two heavy jobs
of different types starting at once → interleaved unloads → both pipes resident → OOM.
Invariant: at most one heavy job (any type) across the process. Each job router
acquires on start (409 when one already runs) and releases in its ``_run`` ``finally``.
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
