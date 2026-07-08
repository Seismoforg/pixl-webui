"""Analysis-driven photo-restoration pipeline: decision engine + orchestrator.

Given an ``AnalysisReport`` and a preset, ``build_plan`` decides which stations run
(measured damage/quality thresholds + per-station user overrides). ``run_pipeline``
runs the enabled stations in order, chaining the EXISTING image ops (CodeFormer face
restore, Real-ESRGAN upscale, FLUX/Kontext beautify + Z-Image img2img pull-back) plus
new classical stations (white-balance, cv2 scratch inpaint, NL-means denoise, CLAHE
tone). Each station keeps a downscaled before/after preview for the UI's per-station
Before/After slider. Nothing runs unless needed.

Prior-fusion (the differentiator) uses the big model's beautify only as a PRIOR:
Kontext is a structure-preserving edit, optionally harmonized by a low-strength
Z-Image img2img pass. A true fidelity-net fusion (ControlNet/Restormer) is deferred —
see the restoration ADR + the feature's open-risk note.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
from PIL import Image
from pydantic import BaseModel

from ..config import DATA_DIR
from .analysis import AnalysisReport

DEFAULT_PRESETS_FILE = Path(__file__).parents[1] / "restore_presets.json"
OVERRIDE_PRESETS_FILE = DATA_DIR / "restore_presets.json"

# Fixed conveyor order. Each station = on/off + one strength slider (0..1).
# Face restoration (CodeFormer) runs BEFORE the generative beautify. Colorize (opt-in,
# for B&W / faded photos) runs after the beautify, before tone/upscale.
STATION_ORDER = [
    "preprocess", "scratch", "denoise", "face", "prior_fusion", "colorize", "tone", "upscale",
]

_PREVIEW_MAX = 512  # long-edge px for the before/after preview data URLs

# Shared beautify body: REMOVE damage + PRESERVE identity, never add an aged look.
# "old photograph" is deliberately avoided (it biases the model toward adding grain).
_BEAUTIFY_BASE = (
    "Remove all scratches, dust, spots, stains and creases. Sharpen and recover fine "
    "detail. Keep the exact same people, faces, expressions, hair, clothing, pose and "
    "background — do NOT change anyone's identity. Do NOT add film grain, noise, texture, "
    "borders or any aged look. Produce a clean, sharp, natural photograph."
)

# Per-colour-mode lead: the ANALYSIS decides the colour intent; the prompt only executes
# it, so a B&W photo is never asked to gain colour (see the colour-mode feature).
_BEAUTIFY_LEAD = {
    "grayscale": "Restore this black-and-white photograph. Keep it BLACK AND WHITE — "
                 "introduce NO colour, preserve the original grayscale.",
    "sepia": "Restore this sepia-toned photograph. Preserve the original sepia tone — "
             "do NOT convert it to grayscale or to full colour.",
    "color": "Restore this colour photograph. Preserve the original colours and tonal "
             "balance — do NOT recolour or desaturate.",
    "faded": "Restore this faded colour photograph. Recover and preserve its original "
             "colours — do NOT desaturate to black-and-white or invent new colours.",
}


def beautify_prompt_for(color_mode: str) -> str:
    """The default beautify instruction for a detected colour mode (used when the caller
    gives no custom prompt) — so the prompt only does what the analysis already decided."""
    lead = _BEAUTIFY_LEAD.get(color_mode, _BEAUTIFY_LEAD["color"])
    return f"{lead} {_BEAUTIFY_BASE}"


def enforce_color_mode(img: Image.Image, color_mode: str) -> Image.Image:
    """Deterministic colour-mode guard: coerce the result back to the detected mode so a
    confident black-and-white source can NEVER gain colour through Kontext/upscale.
    GRAYSCALE-ONLY — sepia/colour sources are returned untouched: sepia over-detection on
    warm colour photos would risk sepia-tinting a real colour photo, so sepia intent is
    carried by the beautify prompt instead. The router applies this only for a
    high-confidence grayscale source when the opt-in colorize station did not run."""
    from PIL import ImageOps

    if color_mode == "grayscale":
        return ImageOps.grayscale(img.convert("RGB")).convert("RGB")
    return img


class StationResult(BaseModel):
    """One station's outcome (progress + pipeline.json record). ``before``/``after`` are
    downscaled JPEG data URLs for the UI's per-station Before/After slider."""

    name: str
    status: str = "pending"  # pending | running | done | skipped
    detail: str = ""
    elapsed: float = 0.0
    strength: float | None = None
    before: str | None = None
    after: str | None = None


# --- Presets ---------------------------------------------------------------------


def load_presets() -> dict:
    """Curated presets: bundled default, replaced wholesale by a git-ignored
    ``data/restore_presets.json`` override when present (mirrors the engine catalog)."""
    path = OVERRIDE_PRESETS_FILE if OVERRIDE_PRESETS_FILE.exists() else DEFAULT_PRESETS_FILE
    return json.loads(path.read_text(encoding="utf-8"))


def preset_names() -> list[str]:
    return list(load_presets().keys())


# --- Decision engine -------------------------------------------------------------


def _metric_for(name: str, report: AnalysisReport) -> float | None:
    """The analysis metric that gates a threshold-gated station, if any."""
    if name == "scratch":
        return report.damage.scratches
    if name == "denoise":
        return report.quality.noise
    return None


def build_plan(report: AnalysisReport, preset_name: str, overrides: dict) -> list[dict]:
    """Decide the ordered station plan from measured metrics + the preset, letting a
    per-station user override (``{station: {enabled?, strength?}}``) win. Returns a list
    of ``{name, enabled, strength, detail, target_long_edge?}`` dicts in run order."""
    presets = load_presets()
    if preset_name not in presets:
        preset_name = "balanced" if "balanced" in presets else next(iter(presets))
    stations = presets[preset_name]["stations"]
    plan: list[dict] = []
    for name in STATION_ORDER:
        cfg = stations.get(name, {})
        ov = overrides.get(name, {})
        enabled = bool(ov.get("enabled", cfg.get("enabled", False)))
        strength = float(ov.get("strength", cfg.get("strength", 0.5)))
        detail = ""
        user_set = "enabled" in ov

        metric = _metric_for(name, report)
        if enabled and not user_set and metric is not None and "threshold" in cfg:
            if metric < cfg["threshold"]:
                enabled, detail = False, f"{metric:.0f} below {cfg['threshold']:.0f} threshold"

        if name == "face" and enabled and not user_set and report.face_count == 0:
            enabled, detail = False, "no faces detected"

        entry = {"name": name, "enabled": enabled, "strength": strength, "detail": detail}

        if name == "upscale":
            target = int(cfg.get("target_long_edge", 0))
            entry["target_long_edge"] = target
            long_edge = max(report.width, report.height)
            if enabled and not user_set and (target <= 0 or long_edge >= target):
                entry["enabled"] = False
                entry["detail"] = "already at target resolution" if target > 0 else "disabled"

        plan.append(entry)
    return plan


# --- Engine resolution (reuse existing catalogs) ---------------------------------


def resolve_engines(overrides: dict | None = None) -> dict:
    """Pick the downloaded engines for the model-backed stations. A per-role override
    slug (``face_engine``/``upscale_engine``/``edit_engine``) wins when it's the right
    kind AND downloaded; otherwise the first downloaded of that kind is used. Missing →
    ``None`` → that station skips with a clear reason."""
    from . import upscalers
    from . import downloader

    overrides = overrides or {}

    def pick(kind: str, slug: str | None):
        if slug:
            chosen = upscalers.get(slug)
            if chosen is not None and chosen.kind == kind and downloader.is_downloaded(slug):
                return chosen
        for e in upscalers.all_engines():
            if e.kind == kind and downloader.is_downloaded(e.slug):
                return e
        return None

    return {
        "face": pick("face_restore", overrides.get("face_engine")),
        "upscale_x4": pick("realesrgan", overrides.get("upscale_engine")),
        "edit": pick("edit", overrides.get("edit_engine")),
        "colorize": pick("colorize", overrides.get("colorize_engine")),
    }


def engine_options() -> dict:
    """Candidate engines per model-backed role (for the UI's model pickers):
    ``{role: [{slug, name, downloaded}]}``. Auto (empty pick) uses the first downloaded."""
    from . import upscalers
    from . import downloader

    def opts(entries):
        return [{"slug": e.slug, "name": e.name, "downloaded": downloader.is_downloaded(e.slug)}
                for e in entries]

    engines = upscalers.all_engines()
    return {
        "face": opts([e for e in engines if e.kind == "face_restore"]),
        "upscale": opts([e for e in engines if e.kind == "realesrgan"]),
        "edit": opts([e for e in engines if e.kind == "edit"]),
        "colorize": opts([e for e in engines if e.kind == "colorize"]),
    }


# --- Preview helper --------------------------------------------------------------


def _preview(img: Image.Image) -> str:
    """Downscaled JPEG data URL (long edge ≤ 512) for a before/after thumbnail."""
    import base64
    import io

    thumb = img.convert("RGB")
    thumb.thumbnail((_PREVIEW_MAX, _PREVIEW_MAX), Image.LANCZOS)
    buf = io.BytesIO()
    thumb.save(buf, format="JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# Public alias for the router's overall Original→Restored before/after previews.
preview = _preview


# --- Classical stations (no model load) ------------------------------------------


def _gray_world(img: Image.Image) -> Image.Image:
    """Gray-world white balance: scale each channel so its mean matches the grey mean."""
    arr = np.asarray(img.convert("RGB")).astype(np.float32)
    means = arr.reshape(-1, 3).mean(0)
    gray = means.mean()
    scale = gray / np.clip(means, 1e-3, None)
    out = np.clip(arr * scale, 0, 255).astype(np.uint8)
    return Image.fromarray(out)


def _station_preprocess(img: Image.Image, strength: float) -> Image.Image:
    from PIL import ImageOps

    fixed = ImageOps.autocontrast(_gray_world(img), cutoff=1)
    return Image.blend(img.convert("RGB"), fixed, float(np.clip(strength, 0, 1)))


def _station_scratch(img: Image.Image, strength: float) -> Image.Image:
    """Detect thin bright/dark line defects (morphology) and fill them with cv2's
    classical inpaint — texture-preserving, no diffusion model, no hallucination risk.
    Diffusion inpaint (LaMa / FLUX-Fill) is a future swap (see ADR)."""
    import cv2

    rgb = np.asarray(img.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    length = 25
    mask = np.zeros(gray.shape, np.uint8)
    for kernel in (cv2.getStructuringElement(cv2.MORPH_RECT, (length, 1)),
                   cv2.getStructuringElement(cv2.MORPH_RECT, (1, length))):
        resp = np.maximum(cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel),
                          cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel))
        # strength lowers the threshold → catches fainter scratches (more aggressive).
        thr = resp.mean() + (4.0 - 2.5 * np.clip(strength, 0, 1)) * resp.std()
        mask[resp > max(15.0, thr)] = 255
    dilate = 1 + int(round(2 * np.clip(strength, 0, 1)))
    mask = cv2.dilate(mask, np.ones((dilate, dilate), np.uint8))
    fixed = cv2.inpaint(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), mask, 3, cv2.INPAINT_TELEA)
    return Image.fromarray(cv2.cvtColor(fixed, cv2.COLOR_BGR2RGB))


def _station_denoise(img: Image.Image, strength: float) -> Image.Image:
    import cv2

    bgr = cv2.cvtColor(np.asarray(img.convert("RGB")), cv2.COLOR_RGB2BGR)
    h = 3 + 9 * float(np.clip(strength, 0, 1))  # NL-means filter strength
    out = cv2.fastNlMeansDenoisingColored(bgr, None, h, h, 7, 21)
    return Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))


def _station_tone(img: Image.Image, strength: float) -> Image.Image:
    """CLAHE local contrast on the L channel + a gentle black/white-point stretch,
    blended by strength. Clips are avoided (autocontrast cutoff)."""
    import cv2
    from PIL import ImageOps

    lab = cv2.cvtColor(np.asarray(img.convert("RGB")), cv2.COLOR_RGB2LAB)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    lab[..., 0] = clahe.apply(lab[..., 0])
    toned = Image.fromarray(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB))
    toned = ImageOps.autocontrast(toned, cutoff=1)
    return Image.blend(img.convert("RGB"), toned, float(np.clip(strength, 0, 1)))


# --- Model-backed stations (reuse existing services) -----------------------------


def _station_face(img, strength, engines, on_step):
    from . import upscale as upscale_svc

    engine = engines.get("face")
    if engine is None:
        raise RuntimeError("no downloaded face-restore engine")
    return upscale_svc.upscale(engine, img, "", tile=False, on_progress=on_step,
                               fidelity=float(np.clip(strength, 0, 1)))


def _station_upscale(img, target_long_edge, engines, on_step):
    from . import upscale as upscale_svc

    engine = engines.get("upscale_x4")
    if engine is None:
        raise RuntimeError("no downloaded upscaler")
    return upscale_svc.upscale(engine, img, "", tile=True, on_progress=on_step)


def _station_colorize(img, strength, engines, on_step):
    """DDColor colorization (opt-in — for B&W / faded photos). ``strength`` blends the
    colourised result over the original, so <1 gives more muted, natural colour."""
    from . import upscale as upscale_svc

    engine = engines.get("colorize")
    if engine is None:
        raise RuntimeError("no downloaded colorize model")
    coloured = upscale_svc.upscale(engine, img, "", tile=False, on_progress=on_step)
    if coloured.size != img.size:
        coloured = coloured.resize(img.size, Image.LANCZOS)
    s = float(np.clip(strength, 0, 1))
    if s >= 0.999:
        return coloured
    return Image.blend(img.convert("RGB"), coloured, s)


def _station_prior_fusion(img, strength, engines, beautify_prompt, color_mode, on_step):
    """Generative beautify via FLUX.1 Kontext — a STRUCTURE-PRESERVING whole-image edit
    (keeps faces/pose/composition, unlike a text2img img2img which invents a new face).
    ``strength`` = how much of the beautify to keep vs the faithful input (alpha blend);
    1.0 = full Kontext, lower stays closer to the original. When the caller gives no
    prompt, the instruction is built from ``color_mode`` (``beautify_prompt_for``) so a
    B&W photo is never asked to gain colour. CodeFormer face restoration runs BEFORE this
    station."""
    from . import edit as edit_svc

    edit_engine = engines.get("edit")
    if edit_engine is None:
        raise RuntimeError("no downloaded edit (beautify) engine")
    prompt = (beautify_prompt or "").strip() or beautify_prompt_for(color_mode)
    prior = edit_svc.edit_image(img, prompt, on_step, edit_engine, steps=28, seed=0)
    if prior.size != img.size:
        prior = prior.resize(img.size, Image.LANCZOS)

    s = float(np.clip(strength, 0, 1))
    if s >= 0.999:
        return prior
    # Kontext preserves structure, so an alpha blend toward the original barely ghosts
    # and gives a "how much beautify" knob without a second generative pass.
    return Image.blend(img.convert("RGB"), prior, s)


# --- Orchestrator ----------------------------------------------------------------


def run_pipeline(image, plan, *, engines, beautify_prompt, color_mode="color",
                 on_station, on_step):
    """Run the enabled stations in order, chaining their outputs. ``on_station(list)`` is
    called after every station transition with the full ``StationResult`` list; the inner
    services report step progress through ``on_step`` (a jobs progress dict callback).
    ``color_mode`` builds the default beautify prompt so a B&W photo isn't asked to gain
    colour. Returns ``(final_image, station_results)``."""
    results = [StationResult(name=st["name"]) for st in plan]
    on_station(results)
    current = image.convert("RGB")

    for i, st in enumerate(plan):
        res = results[i]
        if not st["enabled"]:
            res.status, res.detail = "skipped", st.get("detail") or "disabled"
            on_station(results)
            continue

        res.status, res.strength = "running", st.get("strength")
        before = _preview(current)
        on_station(results)
        t0 = time.perf_counter()
        try:
            current = _run_station(st, current, engines, beautify_prompt, color_mode, on_step)
            res.before, res.after = before, _preview(current)
            res.status = "done"
        except Exception as exc:  # noqa: BLE001 - one station failing skips it, not the run
            res.status, res.detail = "skipped", f"error: {exc}"
        res.elapsed = round(time.perf_counter() - t0, 2)
        on_station(results)

    return current, results


def _run_station(st, img, engines, beautify_prompt, color_mode, on_step):
    name, strength = st["name"], st["strength"]
    if name == "preprocess":
        return _station_preprocess(img, strength)
    if name == "scratch":
        return _station_scratch(img, strength)
    if name == "denoise":
        return _station_denoise(img, strength)
    if name == "face":
        return _station_face(img, strength, engines, on_step)
    if name == "prior_fusion":
        return _station_prior_fusion(img, strength, engines, beautify_prompt, color_mode, on_step)
    if name == "colorize":
        return _station_colorize(img, strength, engines, on_step)
    if name == "tone":
        return _station_tone(img, strength)
    if name == "upscale":
        return _station_upscale(img, st.get("target_long_edge", 0), engines, on_step)
    raise RuntimeError(f"unknown station {name}")
