"""Shared diffusers step-callback wiring and per-step timing.

Diffusers exposes two callback APIs across versions: the modern
``callback_on_step_end`` (>= 0.25) and the legacy ``callback`` +
``callback_steps``. :func:`step_kwargs` wires an ``on_step(completed_steps)``
reporter into whichever the pipe supports, returning the kwargs to pass to
``pipe(...)`` (empty if neither is exposed, so generation still runs without live
step counts).

:class:`StepTimer` reports iterations/second measured from the first completed
step (so model-load time is excluded), shared by the upscale and outpaint step
reporters.
"""
from __future__ import annotations

import inspect
import time
from typing import Callable


def gpu_sync() -> None:
    """Block until queued GPU work finishes so a step timestamp reflects real compute.
    Diffusers denoise steps run async — the step callback fires before the step's GPU
    work completes, which inflates the reported it/s and leaks denoise time into the
    later (synchronous) decode phase. Best-effort; a no-op off-GPU."""
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.synchronize()
    except Exception:  # noqa: BLE001 - timing aid only
        pass


def step_kwargs(pipe, on_step: Callable[[int], None]) -> dict:
    """Return ``pipe(...)`` kwargs that call ``on_step(completed_steps)`` per step.
    Syncs the GPU first so it/s + phase timing reflect real compute (see gpu_sync)."""
    params = inspect.signature(pipe.__call__).parameters
    if "callback_on_step_end" in params:
        def _cb(_pipe, step, _timestep, cb_kwargs):  # diffusers >= 0.25 API
            gpu_sync()
            on_step(step + 1)
            return cb_kwargs

        return {"callback_on_step_end": _cb}
    if "callback" in params:
        def _legacy(step, _timestep, _latents):  # older diffusers API
            gpu_sync()
            on_step(step + 1)

        return {"callback": _legacy, "callback_steps": 1}
    return {}


class StepTimer:
    """Iterations/second measured from the first completed step.

    ``its(completed)`` returns None until at least the second step (one interval is
    needed to measure a rate), matching how generation reports speed.
    """

    def __init__(self) -> None:
        self._start: float | None = None

    def its(self, completed: int) -> float | None:
        now = time.perf_counter()
        if self._start is None and completed >= 1:
            self._start = now
        if self._start is not None and completed > 1:
            elapsed = now - self._start
            if elapsed > 0:
                return (completed - 1) / elapsed
        return None
