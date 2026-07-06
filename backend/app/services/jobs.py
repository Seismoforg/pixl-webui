"""Shared background-job infrastructure for the image-op routers.

The upscale/reframe/inpaint/edit routers each run one job on a background thread,
tracked in an in-memory store guarded by a lock, and report progress via the shared
`BatchProgress`/`UpscaleProgress` shape (defined in routers/upscale.py). This module
holds the parts that were identical across them: the job-state record, the store +
id counter, source resolution, the progress callback, and the gallery-save tail.

Generation (routers/generate.py) has richer per-job state (live preview, its() timing,
per-batch resets) and keeps its own `_Job`, but reuses `JobStore` for the store/lock.
"""
from __future__ import annotations

import threading
import time
from typing import Callable, Generic, Protocol, TypeVar

from .. import live, messages
from . import gallery


class JobState:
    """One image-op job's mutable progress record (batch-capable). Field mutations are
    guarded by the owning `JobStore.lock`."""

    def __init__(self, job_id: str, engine_name: str) -> None:
        self.job_id = job_id
        self.status = "running"
        self.phase = "loading"
        self.current_tile = 0
        self.total_tiles = 0
        self.current_step = 0
        self.total_steps = 0
        self.its: float | None = None
        self.engine_name = engine_name
        self.started_at = time.perf_counter()
        self.image_id: str | None = None
        # Batch state (a run can produce several variants; 1 for single-image jobs).
        self.batch_index = 0
        self.batch_size = 1
        self.image_ids: list[str] = []
        self.error: str | None = None

    def elapsed(self) -> float:
        return time.perf_counter() - self.started_at


class _Identified(Protocol):
    job_id: str


J = TypeVar("J", bound=_Identified)


class JobStore(Generic[J]):
    """In-memory job store — one per router. Its `lock` ALSO guards job-field mutations
    (progress updates), matching the original per-router `_lock`."""

    def __init__(self, prefix: str) -> None:
        self._prefix = prefix
        self._counter = 0
        self._jobs: dict[str, J] = {}
        self.lock = threading.Lock()

    def new_id(self) -> str:
        """Next job id. Caller holds `self.lock` (as the routers did)."""
        self._counter += 1
        return f"{self._prefix}-{self._counter}"

    def add(self, job: J) -> None:
        self._jobs[job.job_id] = job

    def get(self, job_id: str) -> J | None:
        return self._jobs.get(job_id)


def resolve_source(req, missing_msg: str):
    """Load the source PIL image from a gallery id or an uploaded data URL. `req` must
    carry `image_data` / `image_id`. Raises ValueError (→ 400) when the source is
    missing (`missing_msg`) or unreadable (`SOURCE_DECODE_FAILED`)."""
    from PIL import Image

    if req.image_data:
        return gallery.decode_data_url(req.image_data, messages.SOURCE_DECODE_FAILED)
    if req.image_id:
        path = gallery.file_path(req.image_id)
        if path is None:
            raise ValueError(messages.IMAGE_NOT_FOUND.format(image_id=req.image_id))
        return Image.open(path)
    raise ValueError(missing_msg)


def make_on_progress(job: JobState, lock: threading.Lock, pub_key: str) -> Callable[[dict], None]:
    """Build the diffusers progress callback: apply field updates under `lock`, then
    wake the WebSocket pusher (a no-op with no subscriber)."""

    def on_progress(update: dict) -> None:
        with lock:
            for key, value in update.items():
                setattr(job, key, value)
        live.publish(pub_key)

    return on_progress


def save_result(store: JobStore[JobState], job: JobState, result, meta: dict) -> None:
    """Persist one result image + metadata to the gallery and record it on the job (the
    first image also fills `image_id` for single-image compatibility)."""
    saved = gallery.save(result, meta)
    with store.lock:
        if job.image_id is None:
            job.image_id = saved.id
        job.image_ids.append(saved.id)
