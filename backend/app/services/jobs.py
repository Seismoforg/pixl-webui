"""Shared background-job infrastructure for the image-op routers.

The six job routers (generate/compare/upscale/reframe/inpaint/edit) each run one job
on a background thread, tracked in an in-memory store guarded by a lock, and report
progress via the shared `UpscaleProgress`/`BatchProgress` shape (defined here). This
module holds the parts that were identical across them: the progress schemas +
response builders, the job-state record, the store + id counter, the seed cap, source
resolution, the progress callbacks, the job-spawn block (`start_job`), the done/error/
release tail (`job_run`), the incrementing-seed batch loop (`run_batch`), and the
gallery-save tail. Generation subclasses `JobState` for its extra response fields
(seed/prompt/preview); compare keeps its bespoke nested sweep loop.
"""
from __future__ import annotations

import contextlib
import random
import threading
import time
from typing import Callable, Generic, Protocol, TypeVar

from pydantic import BaseModel, Field

from .. import live, messages, samplers
from . import gallery, job_guard, quantize

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


class JobBusy(Exception):
    """Another heavy job already runs (carries the formatted JOB_BUSY message).
    Mapped to a 409 response by the app-level handler in main.py."""


def start_job(
    store: JobStore,
    kind: str,
    run: Callable,
    *args,
    engine_name: str = "",
    make_job: Callable[[str], JobState] | None = None,
) -> JobState:
    """Shared job-spawn block: create the record (`JobState(engine_name)` unless
    `make_job` builds a richer one), acquire the single-job guard (JobBusy → 409),
    register it, and start `run(job, *args)` on a daemon thread. Returns the job."""
    with store.lock:
        job_id = store.new_id()
        job = make_job(job_id) if make_job else JobState(job_id, engine_name)
    busy = job_guard.acquire(job.job_id, kind)
    if busy is not None:
        raise JobBusy(messages.JOB_BUSY.format(kind=busy))
    with store.lock:
        store.add(job)
    threading.Thread(target=run, args=(job, *args), daemon=True).start()
    return job


@contextlib.contextmanager
def job_run(store: JobStore, job: JobState, pub_key: str, fail_msg: str, unload=None):
    """Shared `_run` tail: mark done on success, map any exception into the job's
    error state (`fail_msg.format(detail=...)`), then unload the pipe (if given) and
    release the single-job guard."""
    try:
        yield
        with store.lock:
            job.status = "done"
        live.publish(pub_key)
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI via job state
        with store.lock:
            job.status = "error"
            job.error = fail_msg.format(detail=str(exc))
        live.publish(pub_key)
    finally:
        if unload is not None:
            unload()
        job_guard.release(job.job_id)


def run_batch(
    store: JobStore,
    job: JobState,
    pub_key: str,
    *,
    batch: int,
    seed: int | None,
    render: Callable,
    meta: Callable,
    on_item_start: Callable[[], None] | None = None,
) -> None:
    """Shared incrementing-seed batch loop. Item i uses `(base + i) % (SEED_MAX + 1)`
    (base = `seed`, or random when None); each round sets batch_index + resets the
    per-image markers (then `on_item_start` for extra per-round resets), calls
    `render(index, seed_i)` → final PIL image, publishes the finalizing phase, and
    saves via `save_result(meta(seed_i, result))`. Error/done tail is the caller's
    `job_run` context."""
    base_seed = seed if seed is not None else random.randint(0, SEED_MAX)
    with store.lock:
        job.batch_size = batch
    for i in range(batch):
        seed_i = (base_seed + i) % (SEED_MAX + 1)
        with store.lock:
            job.batch_index = i + 1
            job.start_image()
        if on_item_start is not None:
            on_item_start()
        result = render(i, seed_i)
        with store.lock:
            job.phase = "finalizing"
            job.mark_decode()
        live.publish(pub_key)
        save_result(store, job, result, meta(seed_i, result))


def resolve_sampler(engine, requested: str | None) -> str:
    """Sampler id to RECORD for an engine run: flow-matching engines (FLUX Fill,
    Z-Image, FLUX.2) keep their native scheduler — the services skip apply_sampler —
    so report NATIVE, not the requested id (mirrors generate's effective_sampler)."""
    if quantize.engine_family(engine) is not None:
        return samplers.NATIVE
    return requested or samplers.DEFAULT_SAMPLER


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


def make_on_step(
    job: JobState,
    lock: threading.Lock,
    pub_key: str,
    *,
    running_phase: str,
    finalize: bool = True,
) -> Callable[[int], None]:
    """Adapter for pipeline.generate's integer step callback (generate/compare): clamp
    to total_steps (some pipelines fire one extra callback), stamp first_step_at, keep
    the stored `its` field current ((steps-1)/elapsed since the first step), and — when
    `finalize` — flag the finalizing tail + decode stamp on the last step (compare
    passes False: its phase flips per sheet, not per cell)."""

    def on_step(completed: int) -> None:
        # The callback wiring (callbacks.gpu_sync) already synced the GPU, so this
        # timestamp reflects real compute — step / it-s / decode boundary are accurate.
        now = time.perf_counter()
        with lock:
            if job.first_step_at is None:
                job.first_step_at = now
            completed = min(completed, job.total_steps)
            job.current_step = completed
            if completed > 1:
                since_first = now - job.first_step_at
                if since_first > 0:
                    job.its = (completed - 1) / since_first
            if finalize and completed >= job.total_steps:
                job.phase = "finalizing"
                job.mark_decode()
            else:
                job.phase = running_phase
        live.publish(pub_key)

    return on_step


def save_result(
    store: JobStore[JobState], job: JobState, result, meta: dict, *, record_timing: bool = True
) -> None:
    """Persist one result image + metadata to the gallery and record it on the job (the
    first image also fills `image_id` for single-image compatibility). `record_timing`
    False skips the per-image breakdown (compare's sheets report no timings)."""
    saved = gallery.save(result, meta)
    with store.lock:
        if job.image_id is None:
            job.image_id = saved.id
        job.image_ids.append(saved.id)
        if record_timing:
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
