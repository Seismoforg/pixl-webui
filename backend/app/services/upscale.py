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
from ..device import get_dtype, get_torch_device
from . import callbacks
from . import downloader
from . import vram
from .downloader import is_downloaded
from .optimizations import apply_perf
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


def to_model_info(engine: UpscalerInfo) -> ModelInfo:
    """Wrap a diffusers-based engine as a ``ModelInfo`` for the downloader."""
    return ModelInfo(
        slug=engine.slug,
        repo_id=engine.repo_id,
        name=engine.name,
        family="Upscaler",
        pipeline_tag="image-to-image",
        description=engine.description,
        gated=False,
        approx_size_gb=engine.approx_size_gb,
        min_vram_gb=4.0,
        variant=engine.variant,
        use_safetensors=engine.use_safetensors,
        defaults=GenerationDefaults(steps=0, guidance_scale=0.0, width=0, height=0),
    )


def start_engine_download(engine: UpscalerInfo, token: str | None) -> None:
    """Download an engine's weights into ``models/<slug>`` (background)."""
    if engine.kind == "realesrgan" and engine.filename is not None:
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
        if _sd_x4_slug != keep_slug:
            _sd_x4_pipe = None
            _sd_x4_slug = None
    vram.release()


def upscale(engine: UpscalerInfo, image, prompt: str = "", tile: bool = True, on_progress=None):
    """Upscale a PIL ``image`` with ``engine``; returns a new PIL image.

    With ``tile`` set, large images are split into overlapping tiles and stitched
    back together — this bounds peak VRAM and lets each tile run fast, so oversized
    inputs upscale at full resolution instead of being downscaled first. With
    ``tile`` off the image is processed in a single pass (Real-ESRGAN) or capped to
    a safe input size (SD x4).

    ``on_progress(update: dict)`` is called (if given) as work proceeds with a
    partial stats update (``phase`` / ``current_tile`` / ``total_tiles`` /
    ``current_step`` / ``total_steps``) that the caller merges, so live inference
    stats reflect both tile progress and per-tile diffusion steps.
    """
    if not is_downloaded(engine.slug):
        raise ValueError(messages.MODEL_NOT_DOWNLOADED.format(slug=engine.slug))

    # Maximise VRAM headroom: drop the generation pipeline and any other cached
    # upscaler engine, keeping only the one about to run. Lazy import of pipeline
    # avoids the pipeline <-> upscale import cycle.
    from . import outpaint as _outpaint
    from . import pipeline as _pipeline

    _pipeline.unload()
    _outpaint.unload()
    unload(keep_slug=engine.slug)

    report = on_progress or (lambda _u: None)
    img = image.convert("RGB")
    if engine.kind == "realesrgan":
        return _upscale_realesrgan(engine, img, tile, report)
    if engine.kind == "sd_x4":
        return _upscale_sd_x4(engine, img, prompt, tile, report)
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
    with _lock:
        _realesrgan_cache[engine.slug] = model
    return model


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
    # tile=0 → single pass; otherwise tile only when the image exceeds _TILE.
    out = _tiled_infer(model, tensor, _TILE if tile else 0, scale, report)
    out = out.clamp(0.0, 1.0).squeeze(0).permute(1, 2, 0).cpu().numpy()
    return Image.fromarray((out * 255.0).round().astype("uint8"))


# --- Stable Diffusion x4 upscaler (diffusers) ---------------------------------

# The SD x4 upscaler's diffusers default; passed explicitly so total steps are known.
_SD_X4_STEPS = 75


def _run_sd(pipe, image, prompt: str, report, tile_index: int, tile_total: int):
    """Run one SD x4 pass, reporting live diffusion-step progress for this tile.

    After the last denoising step the pipeline runs a heavy VAE decode of the 4×
    latents (often slower than the steps themselves); flag that tail as
    "finalizing" so the status doesn't appear frozen at the final step.
    """
    # Time the steps (from the first one) so we can report iterations/second, per tile.
    timer = callbacks.StepTimer()

    def on_step(done: int) -> None:
        completed = min(done, _SD_X4_STEPS)
        report({
            # The VAE decode runs after the final step callback; show it as the
            # finalizing tail instead of a stuck "step 75/75".
            "phase": "finalizing" if completed >= _SD_X4_STEPS else "upscaling",
            "current_tile": tile_index,
            "total_tiles": tile_total,
            "current_step": completed,
            "total_steps": _SD_X4_STEPS,
            "its": timer.its(completed),
        })

    # Announce the tile immediately so the UI leaves "loading" before step 1.
    on_step(0)
    kwargs = callbacks.step_kwargs(pipe, on_step)
    result = pipe(
        prompt=prompt or "", image=image, num_inference_steps=_SD_X4_STEPS, **kwargs
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
            if get_torch_device() == "cpu":
                pipe = pipe.to("cpu")
            else:
                pipe.enable_model_cpu_offload()
            pipe.enable_attention_slicing()
            # The x4 upscaler's final VAE decode of the full 4× image is the slow,
            # memory-heavy tail. VAE tiling (via the shared perf settings) decodes
            # it in internal tiles, slashing peak VRAM and avoiding the slow
            # fallback — the main speedup. Best-effort per the user's settings.
            apply_perf(pipe, load_settings())
            _sd_x4_pipe = pipe
            _sd_x4_slug = engine.slug
        return _sd_x4_pipe


def _tiled_sd_x4(pipe, img, prompt: str, scale: int, tile: int, report, overlap: int = 32):
    """Upscale ``img`` tile-by-tile with the SD x4 pipe, stitching the 4× output.

    Each source tile (plus overlap) is upscaled independently; the overlap margin
    is trimmed from every tile's output so seams don't show. Small images run in a
    single pass. ``report(phase, done, total)`` is called after each tile.
    """
    from PIL import Image

    w, h = img.size
    total = _tile_count(w, h, tile)
    if w <= tile and h <= tile:
        return _run_sd(pipe, img, prompt, report, 1, total)

    out = Image.new("RGB", (w * scale, h * scale))
    done = 0
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            x0, y0 = max(0, x - overlap), max(0, y - overlap)
            x1, y1 = min(w, x + tile + overlap), min(h, y + tile + overlap)
            sr = _run_sd(pipe, img.crop((x0, y0, x1, y1)), prompt, report, done + 1, total)
            left, top = (x - x0) * scale, (y - y0) * scale
            tw, th = min(tile, w - x) * scale, min(tile, h - y) * scale
            out.paste(sr.crop((left, top, left + tw, top + th)), (x * scale, y * scale))
            done += 1
    return out


def _upscale_sd_x4(engine: UpscalerInfo, img, prompt: str, tile: bool, report):
    report({"phase": "loading"})
    pipe = _load_sd_x4(engine)
    scale = engine.scale
    if tile:
        # Tile the full-resolution input so it upscales without downscaling first.
        return _tiled_sd_x4(pipe, img, prompt, scale, _SD_X4_MAX_INPUT, report)
    # Untiled: cap the input so a single 4× pass fits in memory.
    return _run_sd(pipe, _cap_input(img, _SD_X4_MAX_INPUT), prompt, report, 1, 1)
