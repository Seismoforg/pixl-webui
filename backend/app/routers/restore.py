"""Analysis-driven photo restoration as a background job.

``POST /api/restore`` analyzes the source (stored gallery image or uploaded data
URL), builds the optimal station plan from the measured report + the chosen preset
(with per-station user overrides), runs the chain, saves the final image to the
gallery and writes ``analysis.json`` / ``pipeline.json`` / ``processing.log`` sidecars.
Progress (current station + per-station Before/After previews + the damage report) is
polled via ``GET /api/restore/{job_id}`` or the ``restore`` WebSocket channel.
"""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import live, messages
from ..config import OUTPUTS_DIR
from ..services import jobs, restore_engine
from ..services.analysis import AnalysisReport, analyze
from ..services.restore_engine import StationResult

router = APIRouter(prefix="/api/restore", tags=["restore"])


class StationOverride(BaseModel):
    enabled: bool | None = None
    strength: float | None = Field(default=None, ge=0.0, le=1.0)


class RestoreRequest(BaseModel):
    image_id: str | None = None
    image_data: str | None = None
    preset: str = "balanced"
    # Per-station conveyor overrides ({station: {enabled?, strength?}}); absent → the
    # preset + analysis thresholds decide.
    stations: dict[str, StationOverride] = {}
    # Prior-fusion beautify instruction (empty → a faithful default).
    beautify_prompt: str = ""
    # Per-role model overrides (slugs); None → the first downloaded of that role.
    face_engine: str | None = None
    upscale_engine: str | None = None
    edit_engine: str | None = None
    colorize_engine: str | None = None


class RestoreStarted(BaseModel):
    job_id: str


class RestoreProgress(jobs.UpscaleProgress):
    """Upscale progress shape + restoration extras: the current station, the measured
    analysis report, and each station's outcome (with Before/After preview data URLs)."""

    preset: str = ""
    current_station: str = ""
    analysis: AnalysisReport | None = None
    stations: list[StationResult] = []
    # Overall Original→Restored before/after preview data URLs (set on completion).
    original: str | None = None
    result: str | None = None


class RestoreJobState(jobs.JobState):
    def __init__(self, job_id: str, engine_name: str) -> None:
        super().__init__(job_id, engine_name)
        self.preset = ""
        self.current_station = ""
        self.analysis: AnalysisReport | None = None
        self.stations: list[dict] = []
        self.original: str | None = None
        self.result: str | None = None


_store: jobs.JobStore[RestoreJobState] = jobs.JobStore("rst")


def _write_sidecars(job_id: str, image_id: str, report: AnalysisReport,
                    plan: list[dict], stations: list[StationResult], preset: str,
                    color_guard: bool) -> None:
    """Persist analysis.json / pipeline.json / processing.log for reproducibility."""
    log_dir = OUTPUTS_DIR / "restore" / job_id
    log_dir.mkdir(parents=True, exist_ok=True)
    (log_dir / "analysis.json").write_text(report.model_dump_json(indent=2), encoding="utf-8")
    color_conf = report.color.scores.get(report.color.mode, 0.0)
    pipeline = {
        "preset": preset,
        "result_image_id": image_id,
        "color_mode": report.color.mode,
        "color_guard_applied": color_guard,
        "stations": [{**{k: s[k] for k in ("name", "enabled", "strength", "detail")},
                      "target_long_edge": s.get("target_long_edge")} for s in plan],
        "results": [s.model_dump(exclude={"before", "after"}) for s in stations],
    }
    (log_dir / "pipeline.json").write_text(json.dumps(pipeline, indent=2), encoding="utf-8")
    guard_note = " · guard: forced grayscale" if color_guard else ""
    lines = [f"restore job {job_id} · preset={preset} · result={image_id}",
             f"  colour: {report.color.mode} ({color_conf:.1%}){guard_note}"]
    for s in stations:
        lines.append(f"  {s.name:13s} {s.status:8s} {s.elapsed:6.2f}s  {s.detail}")
    (log_dir / "processing.log").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _run(job: RestoreJobState, image, req: RestoreRequest) -> None:
    pub_key = f"restore:{job.job_id}"
    on_step = jobs.make_on_progress(job, _store.lock, pub_key)

    def on_station(results: list[StationResult]) -> None:
        running = next((r.name for r in results if r.status == "running"), "")
        with _store.lock:
            job.stations = [r.model_dump() for r in results]
            job.current_station = running
        live.publish(pub_key)

    with jobs.job_run(_store, job, pub_key, messages.RESTORE_FAILED):
        with _store.lock:
            job.phase = "analyzing"
        live.publish(pub_key)
        report = analyze(image)
        with _store.lock:
            job.original = restore_engine.preview(image)
        plan = restore_engine.build_plan(report, req.preset, {
            k: v.model_dump(exclude_none=True) for k, v in req.stations.items()
        })
        engines = restore_engine.resolve_engines({
            "face_engine": req.face_engine,
            "upscale_engine": req.upscale_engine,
            "edit_engine": req.edit_engine,
            "colorize_engine": req.colorize_engine,
        })
        with _store.lock:
            job.analysis = report
            job.preset = req.preset
            job.phase = "restoring"
        live.publish(pub_key)

        result, stations = restore_engine.run_pipeline(
            image, plan, engines=engines, beautify_prompt=req.beautify_prompt,
            color_mode=report.color.mode, on_station=on_station, on_step=on_step,
        )

        # Colour-mode guard: a confident black-and-white source must stay black and white
        # unless the user explicitly ran the opt-in colorize station — no colour can creep
        # in via Kontext/upscale (ADR 0024). Grayscale-only; sepia is prompt-preserved.
        colorized = any(s.name == "colorize" and s.status == "done" for s in stations)
        color_guard = (report.color.mode == "grayscale"
                       and report.color.scores.get("grayscale", 0.0) >= 0.85
                       and not colorized)
        if color_guard:
            result = restore_engine.enforce_color_mode(result, "grayscale")

        with _store.lock:
            job.phase = "finalizing"
            job.result = restore_engine.preview(result)
            job.mark_decode()
        live.publish(pub_key)
        jobs.save_result(_store, job, result, {
            "model_slug": "restore",
            "model_name": f"Restored · {req.preset}",
            "prompt": req.beautify_prompt or f"Photo restoration · {req.preset}",
            "negative_prompt": None,
            "steps": 0, "guidance_scale": 0.0,
            "width": result.width, "height": result.height,
            "seed": 0, "sampler": "restore",
        })
        if job.image_id is not None:
            _write_sidecars(job.job_id, job.image_id, report, plan, stations, req.preset,
                            color_guard)


@router.get("/presets")
def list_presets() -> dict:
    """Curated restoration presets (label + description + station defaults) for the UI."""
    return restore_engine.load_presets()


class RestoreEngineOption(BaseModel):
    slug: str
    name: str
    downloaded: bool


class RestoreEngines(BaseModel):
    """Candidate models per model-backed role, for the restore form's model pickers.
    An empty pick = Auto (the first downloaded of that role)."""

    face: list[RestoreEngineOption]
    upscale: list[RestoreEngineOption]
    edit: list[RestoreEngineOption]
    colorize: list[RestoreEngineOption]


@router.get("/engines", response_model=RestoreEngines)
def list_engines() -> RestoreEngines:
    return RestoreEngines(**restore_engine.engine_options())


@router.post("", response_model=RestoreStarted)
def start_restore(req: RestoreRequest) -> RestoreStarted:
    try:
        image = jobs.resolve_source(req, messages.RESTORE_SOURCE_MISSING)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    job = jobs.start_job(
        _store, "restore", _run, image, req,
        engine_name=f"Restore · {req.preset}",
        make_job=lambda jid: RestoreJobState(jid, f"Restore · {req.preset}"),
    )
    return RestoreStarted(job_id=job.job_id)


@router.get("/{job_id}", response_model=RestoreProgress)
def restore_progress(job_id: str) -> RestoreProgress:
    with _store.lock:
        job = _store.get(job_id)
        if job is None:
            raise HTTPException(404, messages.JOB_NOT_FOUND.format(job_id=job_id))
        base = jobs.to_upscale_progress(job)
        return RestoreProgress(
            **base.model_dump(),
            preset=job.preset,
            current_station=job.current_station,
            analysis=job.analysis,
            stations=[StationResult(**s) for s in job.stations],
            original=job.original,
            result=job.result,
        )
