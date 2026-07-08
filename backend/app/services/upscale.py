"""Image upscaling service.

Dispatches to one of two engines by :class:`UpscalerInfo.kind`:

* ``realesrgan`` — loads a ``.pth`` via :mod:`spandrel` and runs a tiled forward
  pass (tiling bounds VRAM on large inputs).
* ``sd_x4`` — loads a cached ``StableDiffusionUpscalePipeline`` and runs it with
  an optional prompt; oversized inputs are capped first to avoid OOM.

Loaded engines are cached (one Real-ESRGAN model per slug, one SD x4 pipe) so
repeated upscales don't reload weights.
"""
from __future__ import annotations

import threading

from .. import config, messages
from ..catalog import GenerationDefaults, ModelInfo
from ..config import load_settings
from ..device import get_dtype, get_torch_device, place_offloaded
from . import callbacks
from . import downloader
from . import model_slots
from . import vram
from .downloader import is_downloaded
from .optimizations import apply_perf, force_vae_tiling
from .upscalers import UpscalerInfo

# Real-ESRGAN input tile size (in source pixels); larger inputs are processed in
# overlapping tiles so peak VRAM stays bounded regardless of image size.
_TILE = 512
_TILE_OVERLAP = 16
# SD x4 upscales 4×; cap the input's longer side so the 4× output (and the latent
# diffusion in between) fits in memory. 512 in → 2048 out is a safe default.
_SD_X4_MAX_INPUT = 512

_lock = threading.Lock()
# slug -> spandrel ImageModelDescriptor
_realesrgan_cache: dict[str, object] = {}
_sd_x4_pipe = None
_sd_x4_slug: str | None = None
# slug -> spandrel CodeFormer descriptor (face restoration)
_facerestore_cache: dict[str, object] = {}
# slug -> spandrel DDColor descriptor (colorization)
_colorize_cache: dict[str, object] = {}


def to_model_info(engine: UpscalerInfo) -> ModelInfo:
    """Wrap a diffusers-based engine as a ``ModelInfo`` for the downloader.

    GGUF engines (FLUX Fill) forward their ``gguf_*`` fields so the downloader's
    existing GGUF branch fetches the base repo without the transformer weights plus
    the single ``.gguf``."""
    return ModelInfo(
        slug=engine.slug,
        repo_id=engine.repo_id,
        name=engine.name,
        family="Upscaler",
        pipeline_tag="image-to-image",
        description=engine.description,
        gated=False,
        approx_size_gb=engine.approx_size_gb,
        min_vram_gb=engine.min_vram_gb,
        variant=engine.variant,
        use_safetensors=engine.use_safetensors,
        gguf_repo_id=engine.gguf_repo_id,
        gguf_filename=engine.gguf_filename,
        defaults=GenerationDefaults(steps=0, guidance_scale=0.0, width=0, height=0),
    )


def start_engine_download(engine: UpscalerInfo, token: str | None) -> None:
    """Download an engine's weights into ``models/<slug>`` (background)."""
    if engine.kind in ("realesrgan", "face_restore", "colorize") and engine.filename is not None:
        downloader.start_file_download(engine.slug, engine.repo_id, engine.filename, token)
    else:
        downloader.start_download(to_model_info(engine), token)


def unload(keep_slug: str | None = None) -> None:
    """Drop cached upscaler engines and free their VRAM.

    With ``keep_slug`` given, every engine *except* that slug is dropped (used to
    keep only the engine about to run); without it, all engines are dropped.
    """
    global _sd_x4_pipe, _sd_x4_slug
    with _lock:
        for slug in list(_realesrgan_cache):
            if slug != keep_slug:
                _realesrgan_cache.pop(slug, None)
        for slug in list(_facerestore_cache):
            if slug != keep_slug:
                _facerestore_cache.pop(slug, None)
        for slug in list(_colorize_cache):
            if slug != keep_slug:
                _colorize_cache.pop(slug, None)
        if _sd_x4_slug != keep_slug:
            _sd_x4_pipe = None
            _sd_x4_slug = None
    vram.release()


model_slots.register("upscale", unload)


def upscale(engine: UpscalerInfo, image, prompt: str = "", tile: bool = True, on_progress=None,
            sd_x4_steps: int | None = None, fidelity: float | None = None):
    """Upscale a PIL ``image`` with ``engine``; returns a new PIL image.

    With ``tile`` set, large images are split into overlapping tiles and stitched
    back together — this bounds peak VRAM and lets each tile run fast, so oversized
    inputs upscale at full resolution instead of being downscaled first. With
    ``tile`` off the image is processed in a single pass (Real-ESRGAN) or capped to
    a safe input size (SD x4).

    ``sd_x4_steps`` overrides the denoising step count for the SD x4 engine for
    this run; ``None`` falls back to the persisted ``sd_x4_steps`` setting.

    ``fidelity`` (``face_restore`` only) is CodeFormer's identity↔smoothness weight
    (0..1, high = keep identity); ``None`` falls back to a sensible default.

    ``on_progress(update: dict)`` is called (if given) as work proceeds with a
    partial stats update (``phase`` / ``current_tile`` / ``total_tiles`` /
    ``current_step`` / ``total_steps``) that the caller merges, so live inference
    stats reflect both tile progress and per-tile diffusion steps.
    """
    if not is_downloaded(engine.slug):
        raise ValueError(messages.MODEL_NOT_DOWNLOADED.format(slug=engine.slug))

    # Maximise VRAM headroom: drop every other model service (registry) and any other
    # cached upscaler engine, keeping only the one about to run.
    model_slots.acquire("upscale")
    unload(keep_slug=engine.slug)

    report = on_progress or (lambda _u: None)
    img = image.convert("RGB")
    if engine.kind == "realesrgan":
        return _upscale_realesrgan(engine, img, tile, report)
    if engine.kind == "sd_x4":
        return _upscale_sd_x4(engine, img, prompt, tile, report, sd_x4_steps)
    if engine.kind == "face_restore":
        return _restore_faces(engine, img, fidelity, report)
    if engine.kind == "colorize":
        return _colorize(engine, img, report)
    raise ValueError(messages.UPSCALER_NOT_FOUND.format(slug=engine.slug))


def _tile_count(w: int, h: int, tile: int) -> int:
    from math import ceil

    if tile <= 0 or (w <= tile and h <= tile):
        return 1
    return ceil(h / tile) * ceil(w / tile)


# --- Real-ESRGAN (spandrel) ---------------------------------------------------

def _load_spandrel(engine: UpscalerInfo):
    with _lock:
        cached = _realesrgan_cache.get(engine.slug)
    if cached is not None:
        return cached

    from spandrel import ModelLoader

    weight = config.model_dir(engine.slug) / (engine.filename or "")
    model = ModelLoader().load_from_file(str(weight))
    model.to(get_torch_device()).eval()
    # fp16 roughly halves the forward pass's runtime and VRAM on CUDA; only enable
    # it when spandrel reports the architecture supports half precision, so an
    # fp16-unsafe net keeps running in fp32.
    if get_torch_device() == "cuda" and getattr(model, "supports_half", False):
        model.half()
    with _lock:
        _realesrgan_cache[engine.slug] = model
    return model


def _model_dtype(model):
    """The torch dtype of a spandrel model's parameters (fp16 when half is on)."""
    import torch

    try:
        return next(model.model.parameters()).dtype
    except (StopIteration, AttributeError):
        return torch.float32


def _tiled_infer(model, tensor, tile: int, scale: int, report):
    """Run ``model`` over ``tensor`` in overlapping tiles, stitching the output.

    Small images (within a single tile) run in one pass. Overlap is trimmed from
    each tile's output so seams don't show. ``report(phase, done, total)`` is
    called after each tile.
    """
    import torch

    _, _, h, w = tensor.shape
    total = _tile_count(w, h, tile)
    # Real-ESRGAN has no diffusion steps; progress is purely per-tile.
    report({"phase": "upscaling", "current_tile": 0, "total_tiles": total,
            "current_step": 0, "total_steps": 0})
    if tile <= 0 or (h <= tile and w <= tile):
        with torch.no_grad():
            out = model(tensor)
        report({"current_tile": 1, "total_tiles": total})
        return out

    out = torch.zeros(
        tensor.shape[0], tensor.shape[1], h * scale, w * scale,
        dtype=tensor.dtype, device=tensor.device,
    )
    done = 0
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            y0, x0 = max(0, y - _TILE_OVERLAP), max(0, x - _TILE_OVERLAP)
            y1, x1 = min(h, y + tile + _TILE_OVERLAP), min(w, x + tile + _TILE_OVERLAP)
            with torch.no_grad():
                sr = model(tensor[:, :, y0:y1, x0:x1])
            top, left = (y - y0) * scale, (x - x0) * scale
            th, tw = min(tile, h - y) * scale, min(tile, w - x) * scale
            out[:, :, y * scale:y * scale + th, x * scale:x * scale + tw] = sr[
                :, :, top:top + th, left:left + tw
            ]
            done += 1
            report({"current_tile": done, "total_tiles": total})
    return out


def _upscale_realesrgan(engine: UpscalerInfo, img, tile: bool, report):
    import numpy as np
    import torch
    from PIL import Image

    report({"phase": "loading"})
    model = _load_spandrel(engine)
    scale = getattr(model, "scale", engine.scale) or engine.scale
    device = get_torch_device()

    arr = np.asarray(img).astype("float32") / 255.0  # H, W, C
    tensor = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0).to(device)
    # Match the model's precision (fp16 when enabled at load) so the forward pass
    # runs in the faster dtype; bring the result back to fp32 for the PIL convert.
    tensor = tensor.to(_model_dtype(model))
    # tile=0 → single pass; otherwise tile only when the image exceeds _TILE.
    out = _tiled_infer(model, tensor, _TILE if tile else 0, scale, report)
    out = out.float().clamp(0.0, 1.0).squeeze(0).permute(1, 2, 0).cpu().numpy()
    return Image.fromarray((out * 255.0).round().astype("uint8"))


# --- CodeFormer face restoration (spandrel + facexlib) ------------------------

# CodeFormer's identity↔smoothness weight when the request omits one (identity-leaning).
DEFAULT_FIDELITY = 0.7
_extra_arches_registered = False


def _load_codeformer(engine: UpscalerInfo):
    """Load (and cache) the CodeFormer restoration net on the compute device.

    Registers ``spandrel_extra_arches`` once so spandrel recognises the CodeFormer
    architecture, then loads the single ``.pth`` like the Real-ESRGAN path.
    """
    global _extra_arches_registered
    with _lock:
        cached = _facerestore_cache.get(engine.slug)
    if cached is not None:
        return cached

    from spandrel import MAIN_REGISTRY, ModelLoader

    if not _extra_arches_registered:
        from spandrel_extra_arches import EXTRA_REGISTRY

        MAIN_REGISTRY.add(*EXTRA_REGISTRY)
        _extra_arches_registered = True

    weight = config.model_dir(engine.slug) / (engine.filename or "")
    model = ModelLoader().load_from_file(str(weight)).model
    model.to(get_torch_device()).eval()
    with _lock:
        _facerestore_cache[engine.slug] = model
    return model


# --- DDColor colorization (spandrel) ------------------------------------------

def _colorize_device() -> str:
    """DDColor has BatchNorm layers that crash MIOpen on ROCm/gfx1201 (same class of
    failure as CodeFormer detection, ADR 0022) — run it on CPU there; GPU on CUDA."""
    from ..device import get_device_info

    return "cpu" if get_device_info().backend == "rocm" else get_torch_device()


def _load_ddcolor(engine: UpscalerInfo):
    """Load (and cache) a DDColor colorization net via spandrel (extra arch), like the
    CodeFormer path — a single ``.pth``, auto-detected. Placed on the colorize device."""
    global _extra_arches_registered
    with _lock:
        cached = _colorize_cache.get(engine.slug)
    if cached is not None:
        return cached

    from spandrel import MAIN_REGISTRY, ModelLoader

    if not _extra_arches_registered:
        from spandrel_extra_arches import EXTRA_REGISTRY

        MAIN_REGISTRY.add(*EXTRA_REGISTRY)
        _extra_arches_registered = True

    weight = config.model_dir(engine.slug) / (engine.filename or "")
    model = ModelLoader().load_from_file(str(weight))
    model.to(_colorize_device()).eval()
    with _lock:
        _colorize_cache[engine.slug] = model
    return model


# DDColor input is capped to this long edge for the forward pass; colour is low-
# frequency, so the predicted chroma is upsampled and recombined with the full-res
# luminance (keeps detail; bounds cost, important on the CPU/ROCm path).
_COLORIZE_MAX = 640


def _colorize(engine: UpscalerInfo, img, report):
    """Colorize a photo with DDColor. DDColor (via spandrel) takes the LIGHTNESS as a
    1-channel tensor ``(1, 1, H, W)`` and predicts colour. The net runs on a size-capped
    lightness map; its chroma is then recombined (in LAB) with the FULL-RES source
    luminance, so fine detail is preserved and the forward pass stays cheap."""
    import cv2
    import numpy as np
    import torch
    from PIL import Image

    report({"phase": "loading"})
    model = _load_ddcolor(engine)
    device = _colorize_device()
    report({"phase": "upscaling", "current_tile": 0, "total_tiles": 1,
            "current_step": 0, "total_steps": 0})

    rgb = img.convert("RGB")
    scale = min(1.0, _COLORIZE_MAX / max(rgb.size))
    small = (rgb.resize((max(1, round(rgb.width * scale)), max(1, round(rgb.height * scale))),
                        Image.LANCZOS) if scale < 1.0 else rgb)

    lum = np.asarray(small.convert("L")).astype("float32") / 255.0
    tensor = torch.from_numpy(lum).unsqueeze(0).unsqueeze(0).to(device)  # 1, 1, H, W
    with torch.no_grad():
        out = model(tensor)  # 1, 3, H, W (RGB)
    report({"current_tile": 1, "total_tiles": 1})
    out = out.float().clamp(0.0, 1.0).squeeze(0).permute(1, 2, 0).cpu().numpy()
    coloured = Image.fromarray((out * 255.0).round().astype("uint8"))
    if coloured.size != rgb.size:
        coloured = coloured.resize(rgb.size, Image.LANCZOS)

    # Keep the full-res source luminance; take chroma (a,b) from DDColor.
    lab_src = cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2LAB)
    lab_col = cv2.cvtColor(np.asarray(coloured), cv2.COLOR_RGB2LAB)
    lab_src[..., 1] = lab_col[..., 1]
    lab_src[..., 2] = lab_col[..., 2]
    return Image.fromarray(cv2.cvtColor(lab_src, cv2.COLOR_LAB2RGB))


def _face_to_tensor(bgr, device):
    """A 512×512 BGR uint8 face crop → a normalised NCHW tensor in [-1, 1] on device."""
    import torch

    rgb = bgr[:, :, ::-1].astype("float32") / 255.0
    t = torch.from_numpy(rgb.transpose(2, 0, 1).copy())
    return ((t - 0.5) / 0.5).unsqueeze(0).to(device)


def _tensor_to_face(t):
    """A restored [-1, 1] NCHW tensor → a 512×512 BGR uint8 face crop."""
    t = t.squeeze(0).clamp(-1, 1)
    arr = (((t + 1) / 2).detach().cpu().float().numpy().transpose(1, 2, 0) * 255)
    return arr.round().astype("uint8")[:, :, ::-1]  # RGB -> BGR


def _restore_faces(engine: UpscalerInfo, img, fidelity: float | None, report):
    """Detect faces, restore each with CodeFormer at ``fidelity``, paste back.

    Face DETECTION/alignment (facexlib RetinaFace + parsing) runs on the CPU: on
    ROCm/gfx1201 their batch-norm forward raises ``miopenStatusUnknownError`` on the
    GPU, and the nets are tiny so CPU is fine. The heavy CodeFormer restore runs on
    the compute device. Images with no detectable face pass through unchanged.
    """
    import numpy as np
    from PIL import Image

    weight = DEFAULT_FIDELITY if fidelity is None else max(0.0, min(1.0, fidelity))
    device = get_torch_device()
    report({"phase": "loading", "current_tile": 0, "total_tiles": 0,
            "current_step": 0, "total_steps": 0})
    model = _load_codeformer(engine)

    from facexlib.utils.face_restoration_helper import FaceRestoreHelper

    face_cache = config.MODELS_DIR / "facexlib"
    face_cache.mkdir(parents=True, exist_ok=True)
    helper = FaceRestoreHelper(
        upscale_factor=1, face_size=512, crop_ratio=(1, 1),
        det_model="retinaface_resnet50", save_ext="png",
        device="cpu", model_rootpath=str(face_cache),
    )
    helper.clean_all()
    bgr = np.asarray(img)[:, :, ::-1]  # PIL RGB -> BGR
    helper.read_image(bgr)
    n = helper.get_face_landmarks_5(only_center_face=False, resize=640, eye_dist_threshold=5)
    if not n:
        report({"phase": "restoring", "current_tile": 0, "total_tiles": 0})
        return img  # no face detected → return the source unchanged
    helper.align_warp_face()

    import torch

    total = len(helper.cropped_faces)
    for i, face in enumerate(helper.cropped_faces):
        report({"phase": "restoring", "current_tile": i, "total_tiles": total})
        with torch.no_grad():
            out = model(_face_to_tensor(face, device), weight=weight)
            out = out[0] if isinstance(out, (tuple, list)) else out
        helper.add_restored_face(_tensor_to_face(out))
    report({"phase": "restoring", "current_tile": total, "total_tiles": total})
    helper.get_inverse_affine(None)
    result = helper.paste_faces_to_input_image(upsample_img=None)  # BGR
    return Image.fromarray(result[:, :, ::-1])  # BGR -> RGB


# --- Stable Diffusion x4 upscaler (diffusers) ---------------------------------

def _run_sd(pipe, image, prompt: str, report, tile_index: int, tile_total: int, steps: int):
    """Run one SD x4 pass, reporting live diffusion-step progress for this tile.

    ``steps`` is the denoising step count (from the ``sd_x4_steps`` setting).

    After the last denoising step the pipeline runs a heavy VAE decode of the 4×
    latents (often slower than the steps themselves); flag that tail as
    "finalizing" so the status doesn't appear frozen at the final step.
    """
    # Time the steps (from the first one) so we can report iterations/second, per tile.
    timer = callbacks.StepTimer()

    def on_step(done: int) -> None:
        completed = min(done, steps)
        report({
            # The VAE decode runs after the final step callback; show it as the
            # finalizing tail instead of a stuck "step N/N".
            "phase": "finalizing" if completed >= steps else "upscaling",
            "current_tile": tile_index,
            "total_tiles": tile_total,
            "current_step": completed,
            "total_steps": steps,
            "its": timer.its(completed),
        })

    # Announce the tile immediately so the UI leaves "loading" before step 1.
    on_step(0)
    kwargs = callbacks.step_kwargs(pipe, on_step)
    result = pipe(
        prompt=prompt or "", image=image, num_inference_steps=steps, **kwargs
    )
    return result.images[0]


def _cap_input(img, max_side: int):
    from PIL import Image

    longest = max(img.width, img.height)
    if longest <= max_side:
        return img
    scale = max_side / longest
    return img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)


def _load_sd_x4(engine: UpscalerInfo):
    global _sd_x4_pipe, _sd_x4_slug

    from diffusers import StableDiffusionUpscalePipeline

    with _lock:
        if _sd_x4_slug != engine.slug or _sd_x4_pipe is None:
            pipe = StableDiffusionUpscalePipeline.from_pretrained(
                str(config.model_dir(engine.slug)),
                torch_dtype=get_dtype(),
                variant=engine.variant,
            )
            pipe = place_offloaded(pipe)
            # The x4 upscaler's final VAE decode of the full 4× image is the slow,
            # memory-heavy tail. VAE tiling decodes it in internal tiles, slashing
            # peak VRAM and avoiding the slow full-frame fallback — the main speedup.
            # attention slicing / xformers still follow the user's settings.
            apply_perf(pipe, load_settings())
            # Tiling is not optional for this pipe: force it regardless of the
            # vae_tiling setting so the 4× decode never hits the slow/OOM path.
            force_vae_tiling(pipe)
            _sd_x4_pipe = pipe
            _sd_x4_slug = engine.slug
        return _sd_x4_pipe


def _tiled_sd_x4(pipe, img, prompt: str, scale: int, tile: int, report, steps: int, overlap: int = 32):
    """Upscale ``img`` tile-by-tile with the SD x4 pipe, stitching the 4× output.

    Each source tile (plus overlap) is upscaled independently; the overlap margin
    is trimmed from every tile's output so seams don't show. Small images run in a
    single pass. ``report(phase, done, total)`` is called after each tile.
    """
    from PIL import Image

    w, h = img.size
    total = _tile_count(w, h, tile)
    if w <= tile and h <= tile:
        return _run_sd(pipe, img, prompt, report, 1, total, steps)

    out = Image.new("RGB", (w * scale, h * scale))
    done = 0
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            x0, y0 = max(0, x - overlap), max(0, y - overlap)
            x1, y1 = min(w, x + tile + overlap), min(h, y + tile + overlap)
            sr = _run_sd(pipe, img.crop((x0, y0, x1, y1)), prompt, report, done + 1, total, steps)
            left, top = (x - x0) * scale, (y - y0) * scale
            tw, th = min(tile, w - x) * scale, min(tile, h - y) * scale
            out.paste(sr.crop((left, top, left + tw, top + th)), (x * scale, y * scale))
            done += 1
    return out


def _upscale_sd_x4(engine: UpscalerInfo, img, prompt: str, tile: bool, report,
                   sd_x4_steps: int | None = None):
    report({"phase": "loading"})
    pipe = _load_sd_x4(engine)
    scale = engine.scale
    # Per-run override wins; otherwise fall back to the persisted default.
    steps = max(1, sd_x4_steps if sd_x4_steps else load_settings().sd_x4_steps)
    if tile:
        # Tile the full-resolution input so it upscales without downscaling first.
        return _tiled_sd_x4(pipe, img, prompt, scale, _SD_X4_MAX_INPUT, report, steps)
    # Untiled: cap the input so a single 4× pass fits in memory.
    return _run_sd(pipe, _cap_input(img, _SD_X4_MAX_INPUT), prompt, report, 1, 1, steps)
