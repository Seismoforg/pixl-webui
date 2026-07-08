"""Classical-CV photo analysis for the restoration pipeline.

Measures image properties, quality metrics, damage severities and faces so the
decision engine (``restore_engine``) can build the optimal station chain from
MEASURED values instead of running every model on every photo. All heuristics are
dependency-light (numpy / OpenCV / PIL) and rule-based — deliberately swappable for
an ML classifier later (see the restoration ADR). Scores are 0..100 unless noted.
"""
from __future__ import annotations

import numpy as np
from PIL import Image
from pydantic import BaseModel

# --- Response contract (mirrored by the frontend `AnalysisReport` type) ----------


class FaceBox(BaseModel):
    """One detected face as a fraction of image size (0..1), so it's resolution-free."""

    x: float
    y: float
    w: float
    h: float


class QualityMetrics(BaseModel):
    blur: float          # 0 = crisp, 100 = very blurry
    noise: float         # 0 = clean, 100 = very noisy
    sharpness: float     # 0 = soft, 100 = very sharp (inverse-ish of blur)
    contrast: float      # 0 = flat, 100 = punchy
    dynamic_range: float  # 0 = crushed, 100 = full black-to-white range
    exposure: float      # mean luminance 0..100 (50 ≈ mid-grey)


class DamageMetrics(BaseModel):
    scratches: float     # thin bright/dark line coverage
    dust: float          # small-speck coverage
    fading: float        # colour/contrast wash-out
    overexposed: float   # % area blown to white
    underexposed: float  # % area crushed to black


class ColorAnalysis(BaseModel):
    """The photo's colour nature, so restoration preserves it (never colourises a B&W
    photo by accident). ``mode`` = argmax of ``scores``; LAB a/b variance separates true
    grayscale (≈0 variance) from faded colour (weak saturation but real chroma)."""

    mode: str  # "grayscale" | "sepia" | "color" | "faded"
    scores: dict[str, float]  # per-class confidence 0..1 (sums to 1)
    mean_saturation: float     # 0..255
    lab_a_var: float
    lab_b_var: float


class AnalysisReport(BaseModel):
    width: int
    height: int
    megapixels: float
    is_color: bool
    bit_depth: int
    quality: QualityMetrics
    damage: DamageMetrics
    color: ColorAnalysis
    faces: list[FaceBox]
    face_count: int
    scene: str  # "portrait" | "group" | "other"


# --- Helpers ---------------------------------------------------------------------


def _to_gray(arr: np.ndarray) -> np.ndarray:
    """Luminance (uint8 H×W) from an RGB or grayscale uint8 array."""
    if arr.ndim == 2:
        return arr
    return (0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]).astype(np.uint8)


def _laplacian_var(gray: np.ndarray) -> float:
    import cv2

    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _noise_sigma(gray: np.ndarray) -> float:
    """Fast noise std estimate (Immerkær 1996): convolve with a Laplacian-difference
    kernel that cancels smooth content, so the residual ≈ noise."""
    import cv2

    k = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float64)
    conv = cv2.filter2D(gray.astype(np.float64), -1, k)
    h, w = gray.shape
    return float(np.sqrt(np.pi / 2) / (6 * max(1, (w - 2) * (h - 2))) * np.abs(conv).sum())


def _line_damage(gray: np.ndarray, length: int) -> float:
    """Fraction (0..1) of pixels lit by a black-hat/top-hat with a `length`-px line
    kernel in both orientations — catches thin scratches (bright or dark) and specks."""
    import cv2

    hor = cv2.getStructuringElement(cv2.MORPH_RECT, (length, 1))
    ver = cv2.getStructuringElement(cv2.MORPH_RECT, (1, length))
    hits = np.zeros(gray.shape, dtype=bool)
    for kernel in (hor, ver):
        black = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
        top = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)
        resp = np.maximum(black, top)
        # Adaptive threshold: mean + 3σ of the response isolates genuine thin defects
        # from texture; keeps the estimate scale-free across photos.
        thr = resp.mean() + 3.0 * resp.std()
        hits |= resp > max(20.0, thr)
    return float(hits.mean())


def _detect_faces(rgb: np.ndarray) -> list[FaceBox]:
    """Face count/boxes via facexlib RetinaFace on CPU — the SAME detector the
    CodeFormer face station uses (weights already cached under ``models/facexlib``,
    ROCm needs detection on CPU per ADR 0022). Analysis only needs whether/where faces
    are, to gate the face-restoration station. Best-effort: any failure → no faces."""
    try:
        import cv2

        from .. import config
        from facexlib.utils.face_restoration_helper import FaceRestoreHelper

        h, w = rgb.shape[:2]
        helper = FaceRestoreHelper(
            upscale_factor=1, face_size=512, det_model="retinaface_resnet50",
            save_ext="png", device="cpu",
            model_rootpath=str(config.MODELS_DIR / "facexlib"),
        )
        helper.read_image(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        helper.get_face_landmarks_5(only_center_face=False, resize=640, eye_dist_threshold=5)
        boxes: list[FaceBox] = []
        for det in helper.det_faces:
            x1, y1, x2, y2 = det[:4]
            boxes.append(FaceBox(x=float(x1) / w, y=float(y1) / h,
                                 w=float(x2 - x1) / w, h=float(y2 - y1) / h))
        return boxes
    except Exception:  # noqa: BLE001 - detection is best-effort; no faces on failure
        return []


def analyze(image: Image.Image) -> AnalysisReport:
    """Analyze a PIL image and return the measured report driving pipeline decisions."""
    import cv2

    rgb = image.convert("RGB")
    arr = np.asarray(rgb)
    gray = _to_gray(arr)
    h, w = gray.shape

    # --- properties ---
    is_color = image.mode not in ("L", "1", "I", "F") and _is_visually_color(arr)
    bit_depth = {"I": 32, "I;16": 16, "F": 32}.get(image.mode, 8)

    # --- quality ---
    lap_var = _laplacian_var(gray)
    # Map Laplacian variance → sharpness 0..100 (≥500 reads fully sharp), blur = inverse.
    sharpness = float(np.clip(lap_var / 500.0 * 100.0, 0, 100))
    blur = 100.0 - sharpness
    noise = float(np.clip(_noise_sigma(gray) / 12.0 * 100.0, 0, 100))
    contrast = float(np.clip(gray.std() / 64.0 * 100.0, 0, 100))
    p1, p99 = np.percentile(gray, [1, 99])
    dynamic_range = float(np.clip((p99 - p1) / 255.0 * 100.0, 0, 100))
    exposure = float(gray.mean() / 255.0 * 100.0)

    # --- damage ---
    scratches = float(np.clip(_line_damage(gray, length=25) * 100.0 * 8.0, 0, 100))
    dust = float(np.clip(_line_damage(gray, length=5) * 100.0 * 6.0, 0, 100))
    hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)
    sat_mean = float(hsv[..., 1].mean())
    # Fading = washed-out colour AND low contrast (both point at age/exposure fade).
    fade_sat = np.clip((60.0 - sat_mean) / 60.0, 0, 1) if is_color else 0.5
    fade_con = np.clip((45.0 - contrast) / 45.0, 0, 1)
    fading = float(np.clip((0.6 * fade_sat + 0.4 * fade_con) * 100.0, 0, 100))
    overexposed = float((gray >= 250).mean() * 100.0)
    underexposed = float((gray <= 5).mean() * 100.0)

    faces = _detect_faces(arr)
    scene = "group" if len(faces) >= 2 else ("portrait" if len(faces) == 1 else "other")

    return AnalysisReport(
        width=w, height=h, megapixels=round(w * h / 1e6, 2),
        is_color=is_color, bit_depth=bit_depth,
        quality=QualityMetrics(blur=round(blur, 1), noise=round(noise, 1),
                               sharpness=round(sharpness, 1), contrast=round(contrast, 1),
                               dynamic_range=round(dynamic_range, 1), exposure=round(exposure, 1)),
        damage=DamageMetrics(scratches=round(scratches, 1), dust=round(dust, 1),
                             fading=round(fading, 1), overexposed=round(overexposed, 1),
                             underexposed=round(underexposed, 1)),
        color=classify_color(arr),
        faces=faces, face_count=len(faces), scene=scene,
    )


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def classify_color(arr: np.ndarray) -> ColorAnalysis:
    """Classify a photo's colour nature into grayscale / sepia / color / faded from
    saturation + LAB a/b variance & offset. LAB a/b VARIANCE is the key signal: a true
    B&W scan has ≈0 a/b variance, a faded colour photo keeps measurable chroma variance
    despite low saturation — so faded colour is never mistaken for B&W. Rule-based soft
    scores (softmax) → a confidence per class; ``mode`` = the argmax."""
    import math

    import cv2

    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr], -1)
    hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)
    mean_sat = float(hsv[..., 1].mean())  # 0..255
    lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB).astype(np.float32)
    a, b = lab[..., 1], lab[..., 2]  # cv2 8-bit LAB: neutral = 128
    a_off, b_off = float(a.mean() - 128.0), float(b.mean() - 128.0)
    a_var, b_var = float(a.var()), float(b.var())
    warmth = max(0.0, b_off) + 0.5 * max(0.0, a_off)  # sepia = uniform warm tone

    # Hue diversity among reasonably-saturated pixels: 0 = one hue (sepia/mono-tint),
    # 1 = many hues (real colour). Circular spread → separates sepia from colour.
    hue = hsv[..., 0].astype(np.float32) * 2.0  # cv2 H [0,180] → degrees
    mask = hsv[..., 1] > 30
    if int(mask.sum()) > 50:
        ang = np.deg2rad(hue[mask])
        resultant = float(np.sqrt(np.cos(ang).mean() ** 2 + np.sin(ang).mean() ** 2))
        hue_div = 1.0 - resultant
    else:
        hue_div = 0.0

    aff = {
        # near-zero saturation + flat chroma → true black & white (safe default when
        # ambiguous: preserving mono never wrongly colourises a photo)
        "grayscale": 3.0 * math.exp(-mean_sat / 4.0) * math.exp(-(a_var + b_var) / 6.0),
        # strong warm tint + a SINGLE hue (near-monochrome) → sepia. hue_div must be
        # tiny (a warm-palette colour photo sits at ~0.2-0.4 and stays "colour").
        "sepia": 2.6 * _clamp01(warmth / 11.0) * _clamp01((0.12 - hue_div) / 0.12)
        * _clamp01(mean_sat / 25.0),
        # low-but-present saturation, not sepia → faded colour
        "faded": 1.8 * _clamp01((50.0 - mean_sat) / 45.0) * _clamp01(mean_sat / 6.0),
        # strong saturation OR diverse hues → full colour
        "color": _clamp01(mean_sat / 60.0) + 1.2 * _clamp01(hue_div / 0.35),
    }
    peak = max(aff.values())
    exps = {k: math.exp((v - peak) * 2.0) for k, v in aff.items()}
    total = sum(exps.values()) or 1.0
    scores = {k: round(v / total, 4) for k, v in exps.items()}
    mode = max(scores, key=scores.get)
    return ColorAnalysis(mode=mode, scores=scores, mean_saturation=round(mean_sat, 1),
                         lab_a_var=round(a_var, 1), lab_b_var=round(b_var, 1))


def _is_visually_color(arr: np.ndarray) -> bool:
    """True when R/G/B differ enough to be a real colour photo (not a grayscale scan
    stored as RGB). Mean absolute channel spread > 6 → colour."""
    if arr.ndim == 2:
        return False
    spread = np.abs(arr[..., 0].astype(np.int16) - arr[..., 1]) + \
        np.abs(arr[..., 1].astype(np.int16) - arr[..., 2])
    return float(spread.mean()) > 6.0
