"""Model-slot registry — "one heavy model resident" without O(n²) wiring.

Each pipe-caching service (generation pipeline, upscale, inpaint_engine, edit)
registers its ``unload`` here at import. Before loading, a service calls
``acquire(<own name>)``: every OTHER registered slot is unloaded (each unload does
its own ``vram.release``), then a final release guarantees the freed VRAM is back
with the allocator. Replaces the previous hand-wired mutual lazy-import unloads —
a new model service only registers itself, no other service changes.

Serialization of jobs (so two loads never interleave) stays with job_guard (ADR 0014).
"""
from __future__ import annotations

import threading
from typing import Callable

from . import vram

_lock = threading.Lock()
_unloaders: dict[str, Callable[[], None]] = {}


def register(name: str, unload: Callable[[], None]) -> None:
    """Register a service's no-arg unload under its slot ``name`` (once, at import)."""
    with _lock:
        _unloaders[name] = unload


def acquire(name: str) -> None:
    """Free every registered slot EXCEPT ``name`` — call right before loading into
    that slot. Services not imported yet hold nothing, so skipping them is safe."""
    with _lock:
        others = [unload for slot, unload in _unloaders.items() if slot != name]
    for unload in others:
        unload()
    vram.release()
