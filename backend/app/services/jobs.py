"""Shared background-job infrastructure for the image-op routers.

The upscale/reframe/inpaint/edit routers each run one job on a background thread,
tracked in an in-memory store guarded by a lock, and report progress via the shared
`UpscaleProgress`/`BatchProgress` shape (defined here). This module holds the parts
that were identical across them: the progress schemas + response builders, the
job-state record, the store + id counter, the seed cap, source resolution, the
progress callback, and the gallery-save tail.

Generation (routers/generate.py) has richer per-job state (live preview, its() timing,
per-batch resets) and keeps its own `_Job`, but reuses `JobStore` for the store/lock.
"""
from __future__ import annotations

import threading
import time
from typing import Callable, Generic, Protocol, TypeVar

from pydantic import BaseModel, Field

from .. import live, messages
from . import gallery

# Seed cap for random seeds + batch seed-wrapping (32-bit), shared by the job routers.
SEED_MAX = 2**32 - 1


class LoraRef(BaseModel):
    """One LoRA adapter to blend into a run (family-matched + downloaded). Shared by the
    generate + edit request schemas."""

    slug: str
    weight: float = Field(default=1.0, ge=0.0, le=2.0)


class PhaseTimings(BaseModel):
    """Per-image wall-clock breakdown (seconds), mirroring generation's breakdown so the
    frontend can render it identically. ``generate`` is the denoise/process phase."""

    load: float
    generate: float
    decode: float
    total: float


class UpscaleProgress(BaseModel):
    job_id: str
    status: str  # "running" | "done" | "error"
    phase: str  # "loading" | "upscaling" | "finalizing"
    current_tile: int
    total_tiles: int
    current_step: int
    total_steps: int
    its: float | None  # iterations/second (SD x4 steps); None until measurable
    elapsed: float  # seconds since the job started
    engine_name: str
    # One breakdown per finished image, aligned with image_ids (batch jobs append one
    # per variant; single-image jobs have at most one).
    timings: list[PhaseTimings] = []
    image_id: str | None = None
    error: str | None = None


class BatchProgress(UpscaleProgress):
    """A batch job's progress = the shared upscale shape plus batch fields (a superset,
    so the frontend's upscale-based live-stats UI keeps working unchanged). Shared by
    the reframe, inpaint and edit jobs, which each generate a batch of variants."""

    batch_index: int = 0
    batch_size: int = 1
    image_ids: list[str] = []


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
        # Per-image phase markers (perf_counter) + the accumulated breakdown. The GPU is
        # synced in the step callback (callbacks.gpu_sync), so these reflect real compute.
        self.load_started_at: float | None = time.perf_counter()
        self.first_step_at: float | None = None
        self.decode_started_at: float | None = None
        self.image_timings: list[dict] = []

    def elapsed(self) -> float:
        return time.perf_counter() - self.started_at

    def start_image(self) -> None:
        """Reset the per-image phase markers — call at the start of each batch variant."""
        self.load_started_at = time.perf_counter()
        self.first_step_at = None
        self.decode_started_at = None

    def mark_decode(self) -> None:
        """Stamp the decode-phase start (once) — the transition to 'finalizing'."""
        if self.decode_started_at is None:
            self.decode_started_at = time.perf_counter()

    def record_image_timing(self) -> None:
        """Append this image's load/generate/decode/total breakdown from the markers."""
        done = time.perf_counter()
        load_at = self.load_started_at or done
        proc_at = self.first_step_at or done
        dec_at = self.decode_started_at or done
        self.image_timings.append({
            "load": max(0.0, proc_at - load_at),
            "generate": max(0.0, dec_at - proc_at),
            "decode": max(0.0, done - dec_at),
            "total": max(0.0, done - load_at),
        })


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
            # Stamp the phase markers off the same updates (GPU already synced by the
            # step callback): the first denoise step, and the decode start. Decode is
            # stamped at the LAST step (before the service's internal VAE decode) so the
            # decode phase captures that decode — mirroring generation. A "finalizing"
            # phase (upscale reports it) also stamps it; pure-PIL flows with no steps get
            # it from the router's mark_decode().
            cur, tot = update.get("current_step"), update.get("total_steps")
            if job.first_step_at is None and (cur or 0) >= 1:
                job.first_step_at = time.perf_counter()
            if update.get("phase") == "finalizing" or (cur is not None and tot and cur >= tot):
                job.mark_decode()
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
        job.record_image_timing()


def to_upscale_progress(job: JobState) -> UpscaleProgress:
    """Snapshot a JobState as the single-image `UpscaleProgress` response. Caller holds
    `store.lock` (as the progress endpoints do)."""
    return UpscaleProgress(
        job_id=job.job_id,
        status=job.status,
        phase=job.phase,
        current_tile=job.current_tile,
        total_tiles=job.total_tiles,
        current_step=job.current_step,
        total_steps=job.total_steps,
        its=job.its,
        elapsed=round(job.elapsed(), 1),
        engine_name=job.engine_name,
        timings=[PhaseTimings(**t) for t in job.image_timings],
        image_id=job.image_id,
        error=job.error,
    )


def to_batch_progress(job: JobState) -> BatchProgress:
    """Snapshot a JobState as a `BatchProgress` response (upscale shape + batch fields).
    Caller holds `store.lock`."""
    return BatchProgress(
        **to_upscale_progress(job).model_dump(),
        batch_index=job.batch_index,
        batch_size=job.batch_size,
        image_ids=list(job.image_ids),
    )
