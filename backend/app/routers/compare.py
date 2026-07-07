"""XYZ-plot compare: sweep a generation parameter over a list of values and render
a labelled contact-sheet grid.

``POST /api/compare`` starts a background job that loops :func:`pipeline.generate`
over the cartesian product of 1–3 axes (one model load covers the whole sweep) and
composes the results into a grid saved to the gallery. ``GET /api/compare/{job_id}``
reports progress via the shared ``BatchProgress`` shape (cell index = batch index).
"""
from __future__ import annotations

import itertools
import random
import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import live, messages, samplers
from ..catalog import get_model
from ..services import gallery, grid, job_guard, jobs, pipeline
from ..services.jobs import BatchProgress

router = APIRouter(prefix="/api/compare", tags=["compare"])

# Bound the combinatorial blow-up: the product of the axis lengths can't exceed this.
MAX_CELLS = 64

# Sweepable parameter -> (pipeline.generate kwarg, coerce, human label). A whitelist
# so an axis can only drive a known, bounded generation parameter.
_PARAMS: dict[str, tuple[str, str]] = {
    "steps": ("steps", "Steps"),
    "guidance_scale": ("guidance_scale", "CFG"),
    "sampler": ("sampler", "Sampler"),
    "seed": ("seed", "Seed"),
    "prompt": ("prompt", "Prompt"),
}


class Axis(BaseModel):
    param: str
    values: list  # ints (steps/seed) | floats (guidance) | sampler ids


class CompareRequest(BaseModel):
    slug: str
    prompt: str = Field(min_length=1)
    negative_prompt: str | None = None
    width: int = Field(default=1024, ge=128, le=2048)
    height: int = Field(default=1024, ge=128, le=2048)
    # Base values for the parameters NOT being swept.
    steps: int = Field(default=30, ge=1, le=150)
    guidance_scale: float = Field(default=7.0, ge=0, le=30)
    seed: int | None = None
    sampler: str = samplers.DEFAULT_SAMPLER
    # 1..3 axes: X = columns, Y = rows, Z = one sheet per value.
    axes: list[Axis] = Field(min_length=1, max_length=3)
    # Also persist each individual cell image to the gallery (not just the grid sheet).
    save_individuals: bool = True


class CompareStarted(BaseModel):
    job_id: str


class _Job:
    """Mutable in-process state for one compare sweep."""

    def __init__(self, job_id: str, total_cells: int, engine_name: str) -> None:
        self.job_id = job_id
        self.status = "running"
        self.phase = "loading"  # loading | comparing | finalizing
        self.current_step = 0
        self.total_steps = 0
        self.cell_index = 0  # 1-based index of the cell currently generating
        self.total_cells = total_cells
        self.engine_name = engine_name
        self.started_at = time.perf_counter()
        self.image_id: str | None = None
        self.image_ids: list[str] = []  # one per Z-slice sheet
        self.error: str | None = None
        self.first_step_at: float | None = None

    def elapsed(self) -> float:
        return time.perf_counter() - self.started_at

    def its(self) -> float | None:
        if self.first_step_at is None or self.current_step <= 1:
            return None
        elapsed = time.perf_counter() - self.first_step_at
        return (self.current_step - 1) / elapsed if elapsed > 0 else None


_store: jobs.JobStore[_Job] = jobs.JobStore("cmp")


def _coerce(param: str, values: list) -> list:
    """Validate + coerce an axis's values against the swept parameter's domain,
    raising ValueError (→ 400) on anything out of range or malformed."""
    if not values:
        raise ValueError(messages.COMPARE_VALUES_REQUIRED.format(param=param))
    out: list = []
    try:
        for v in values:
            if param == "steps":
                iv = int(v)
                if not 1 <= iv <= 150:
                    raise ValueError
                out.append(iv)
            elif param == "seed":
                iv = int(v)
                if not 0 <= iv <= jobs.SEED_MAX:
                    raise ValueError
                out.append(iv)
            elif param == "guidance_scale":
                fv = float(v)
                if not 0 <= fv <= 30:
                    raise ValueError
                out.append(fv)
            elif param == "sampler":
                sv = str(v)
                if sv not in {s.id for s in samplers.list_samplers()}:
                    raise ValueError
                out.append(sv)
            elif param == "prompt":
                if not isinstance(v, dict):
                    raise ValueError
                text = str(v.get("prompt", ""))
                if not text.strip():
                    raise ValueError
                negative = v.get("negative")
                negative = str(negative) if negative else None
                out.append({"prompt": text, "negative_prompt": negative})
    except (TypeError, ValueError) as exc:
        raise ValueError(messages.COMPARE_VALUE_INVALID.format(param=param)) from exc
    return out


def _fmt_value(param: str, value) -> str:
    label = _PARAMS[param][1]
    if param == "sampler":
        by_id = {s.id: s.label for s in samplers.list_samplers()}
        return f"{label}: {by_id.get(value, value)}"
    if param == "prompt":
        text = value["prompt"] if isinstance(value, dict) else str(value)
        short = text if len(text) <= 24 else f"{text[:23]}…"
        return f"{label}: {short}"
    return f"{label}: {value}"


def _run(job: _Job, req: CompareRequest, model, axes: list[tuple[str, list]]) -> None:
    key = f"compare:{job.job_id}"

    def on_step(completed: int) -> None:
        with _store.lock:
            if job.first_step_at is None:
                job.first_step_at = time.perf_counter()
            job.current_step = min(completed, job.total_steps)
            job.phase = "comparing"
        live.publish(key)

    # X = axes[0], Y = axes[1] (optional), Z = axes[2] (optional). Missing axes
    # collapse to a single unlabelled row / sheet.
    x_param, x_values = axes[0]
    y_param, y_values = axes[1] if len(axes) > 1 else ("", [None])
    z_param, z_values = axes[2] if len(axes) > 2 else ("", [None])

    base_seed = req.seed if req.seed is not None else random.randint(0, jobs.SEED_MAX)

    try:
        cell_no = 0
        for zi, z in enumerate(z_values):
            rows: list[list] = []
            for y in y_values:
                row: list = []
                for x in x_values:
                    overrides = {x_param: x}
                    if y_param:
                        overrides[y_param] = y
                    if z_param:
                        overrides[z_param] = z
                    cell_no += 1
                    # Effective per-cell params: a swept value overrides the base. The
                    # "prompt" axis carries a {prompt, negative_prompt} pair.
                    prompt_ov = overrides.get("prompt")
                    eff_prompt = prompt_ov["prompt"] if prompt_ov else req.prompt
                    eff_negative = (
                        prompt_ov["negative_prompt"] if prompt_ov else req.negative_prompt
                    )
                    eff_steps = int(overrides.get("steps", req.steps))
                    eff_guidance = float(overrides.get("guidance_scale", req.guidance_scale))
                    eff_seed = int(overrides.get("seed", base_seed))
                    eff_sampler = str(overrides.get("sampler", req.sampler))
                    with _store.lock:
                        job.cell_index = cell_no
                        job.current_step = 0
                        job.first_step_at = None
                        job.phase = "loading"
                        job.total_steps = eff_steps
                    live.publish(key)

                    image, _sampler = pipeline.generate(
                        model=model,
                        prompt=eff_prompt,
                        negative_prompt=eff_negative,
                        steps=eff_steps,
                        guidance_scale=eff_guidance,
                        width=req.width,
                        height=req.height,
                        seed=eff_seed,
                        sampler=eff_sampler,
                        on_step=on_step,
                    )
                    row.append(image)
                    if req.save_individuals:
                        gallery.save(
                            image,
                            {
                                "model_slug": model.slug,
                                "model_name": model.name,
                                "prompt": eff_prompt,
                                "negative_prompt": eff_negative,
                                "steps": eff_steps,
                                "guidance_scale": eff_guidance,
                                "width": req.width,
                                "height": req.height,
                                "seed": eff_seed,
                                "sampler": eff_sampler,
                            },
                        )
                rows.append(row)

            with _store.lock:
                job.phase = "finalizing"
            live.publish(key)

            x_labels = [_fmt_value(x_param, x) for x in x_values]
            y_labels = [_fmt_value(y_param, y) for y in y_values] if y_param else [""]
            title = _fmt_value(z_param, z) if z_param else ""
            sheet = grid.compose_grid(rows, x_labels, y_labels, title)
            meta = gallery.save(
                sheet,
                {
                    "model_slug": model.slug,
                    "model_name": model.name,
                    "prompt": f"{req.prompt} · {title}" if title else req.prompt,
                    "negative_prompt": req.negative_prompt,
                    "steps": 0,
                    "guidance_scale": 0.0,
                    "width": sheet.width,
                    "height": sheet.height,
                    "seed": base_seed,
                    "sampler": "compare",
                },
            )
            with _store.lock:
                if job.image_id is None:
                    job.image_id = meta.id
                job.image_ids.append(meta.id)
            live.publish(key)

        with _store.lock:
            job.status = "done"
        live.publish(key)
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI via job state
        with _store.lock:
            job.status = "error"
            job.error = messages.COMPARE_FAILED.format(detail=str(exc))
        live.publish(key)
    finally:
        job_guard.release(job.job_id)


@router.post("", response_model=CompareStarted)
def start_compare(req: CompareRequest) -> CompareStarted:
    model = get_model(req.slug)
    if model is None:
        raise HTTPException(404, messages.MODEL_NOT_FOUND.format(slug=req.slug))

    # Validate + coerce every axis before starting anything (bad input → 400).
    axes: list[tuple[str, list]] = []
    for axis in req.axes:
        if axis.param not in _PARAMS:
            raise HTTPException(400, messages.COMPARE_PARAM_INVALID.format(param=axis.param))
        try:
            axes.append((axis.param, _coerce(axis.param, axis.values)))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    total_cells = 1
    for _param, values in axes:
        total_cells *= len(values)
    if total_cells > MAX_CELLS:
        raise HTTPException(
            400, messages.COMPARE_TOO_MANY_CELLS.format(count=total_cells, max=MAX_CELLS)
        )

    with _store.lock:
        job = _Job(_store.new_id(), total_cells=total_cells, engine_name=model.name)
    busy = job_guard.acquire(job.job_id, "compare")
    if busy is not None:
        raise HTTPException(409, messages.JOB_BUSY.format(kind=busy))
    with _store.lock:
        _store.add(job)

    thread = threading.Thread(target=_run, args=(job, req, model, axes), daemon=True)
    thread.start()
    return CompareStarted(job_id=job.job_id)


@router.get("/{job_id}", response_model=BatchProgress)
def compare_progress(job_id: str) -> BatchProgress:
    with _store.lock:
        job = _store.get(job_id)
        if job is None:
            raise HTTPException(404, messages.JOB_NOT_FOUND.format(job_id=job_id))
        return BatchProgress(
            job_id=job.job_id,
            status=job.status,
            phase=job.phase,
            current_tile=0,
            total_tiles=0,
            current_step=job.current_step,
            total_steps=job.total_steps,
            its=job.its(),
            elapsed=round(job.elapsed(), 1),
            engine_name=job.engine_name,
            image_id=job.image_id,
            error=job.error,
            batch_index=job.cell_index,
            batch_size=job.total_cells,
            image_ids=list(job.image_ids),
        )
