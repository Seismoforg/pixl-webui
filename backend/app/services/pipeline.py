"""diffusers text-to-image pipeline service.

Loads a downloaded model into an ``AutoPipelineForText2Image`` and runs
generation. One pipeline is cached at a time; switching models unloads the
previous one. Unsupported call kwargs (e.g. ``negative_prompt`` on FLUX) are
filtered out based on the pipeline's actual signature.
"""
from __future__ import annotations

import inspect
import time
from typing import Callable

from .. import config, messages, samplers
from ..catalog import ModelInfo
from ..device import get_dtype, get_torch_device
from . import preview as preview_svc
from .downloader import is_downloaded
from .fit import assess

# Minimum wall-clock gap between decoded previews, so high step counts don't spam
# the (relatively) expensive decode + JPEG encode.
_PREVIEW_MIN_INTERVAL_S = 0.4

_current_slug: str | None = None
_pipeline = None
# Cached image-to-image pipeline built from the text2img one (shares weights).
_img2img_pipe = None
_img2img_slug: str | None = None
# Whether an IP-Adapter is currently loaded on the text2img pipe.
_ip_adapter_loaded = False

# family -> (repo_id, subfolder, weight_name) for IP-Adapter "style" conditioning.
# Only UNet families have ready diffusers IP-Adapters; others fall back (blocked).
_IP_ADAPTERS: dict[str, tuple[str, str, str]] = {
    "SD 1.5": ("h94/IP-Adapter", "models", "ip-adapter_sd15.safetensors"),
    "SDXL": ("h94/IP-Adapter", "sdxl_models", "ip-adapter_sdxl.safetensors"),
}


def supports_ip_adapter(family: str) -> bool:
    return family in _IP_ADAPTERS


def _reset_aux_state() -> None:
    """Drop derived pipelines/adapter state tied to the current base pipeline."""
    global _img2img_pipe, _img2img_slug, _ip_adapter_loaded
    _img2img_pipe = None
    _img2img_slug = None
    _ip_adapter_loaded = False


def _load(model: ModelInfo):
    global _current_slug, _pipeline

    if _current_slug == model.slug and _pipeline is not None:
        return _pipeline

    from diffusers import AutoPipelineForText2Image

    _pipeline = None  # free the previous pipeline before loading a new one
    _reset_aux_state()
    pipe = AutoPipelineForText2Image.from_pretrained(
        str(config.model_dir(model.slug)),
        torch_dtype=get_dtype(),
        variant=model.variant,
        use_safetensors=model.use_safetensors,
    )

    # Place the model per the fit verdict so the UI badge matches reality: models
    # that fit go fully on the GPU; larger ones stream weights via CPU offloading.
    device = get_torch_device()
    if device == "cpu" or assess(model).verdict == "fits_gpu":
        pipe = pipe.to(device)
    else:
        pipe.enable_model_cpu_offload()
    pipe.enable_attention_slicing()

    _current_slug = model.slug
    _pipeline = pipe
    return pipe


def unload(slug: str | None = None) -> None:
    """Free the cached pipeline.

    With ``slug`` given, only unloads if that model is the one currently cached
    (used when a model is deleted so the cache doesn't point at removed files).
    Without a slug, always unloads.
    """
    global _current_slug, _pipeline
    if slug is not None and _current_slug != slug:
        return
    _pipeline = None
    _current_slug = None
    _reset_aux_state()


def _img2img(model: ModelInfo, base_pipe):
    """Return a cached image-to-image pipeline sharing the base pipe's weights."""
    global _img2img_pipe, _img2img_slug
    if _img2img_slug == model.slug and _img2img_pipe is not None:
        return _img2img_pipe

    from diffusers import AutoPipelineForImage2Image

    _img2img_pipe = AutoPipelineForImage2Image.from_pipe(base_pipe)
    _img2img_slug = model.slug
    return _img2img_pipe


def _ensure_ip_adapter(pipe, model: ModelInfo) -> None:
    """Load the family's IP-Adapter onto ``pipe`` if not already loaded.

    Raises ValueError for families without a supported IP-Adapter.
    """
    global _ip_adapter_loaded
    if not supports_ip_adapter(model.family):
        raise ValueError(messages.IP_ADAPTER_UNSUPPORTED.format(family=model.family))
    if _ip_adapter_loaded:
        return
    # Attention slicing installs SlicedAttnProcessor, which is incompatible with
    # IP-Adapter's attention processors (it raises "SlicedAttnProcessor missing
    # slice_size" during load). Turn it off before loading the adapter; SDPA
    # (the default processor) is memory-efficient anyway.
    pipe.disable_attention_slicing()
    repo, subfolder, weight = _IP_ADAPTERS[model.family]
    pipe.load_ip_adapter(repo, subfolder=subfolder, weight_name=weight)
    _ip_adapter_loaded = True


def _contain_pad(image, width: int, height: int):
    """Fit ``image`` into ``width``x``height`` preserving aspect ratio, centered on
    a black background (letterbox/pillarbox). Avoids the distortion a plain resize
    would cause when the reference aspect ratio differs from the canvas."""
    from PIL import Image

    img = image.convert("RGB")
    scale = min(width / img.width, height / img.height)
    new_w = max(1, round(img.width * scale))
    new_h = max(1, round(img.height * scale))
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGB", (width, height), (0, 0, 0))
    canvas.paste(resized, ((width - new_w) // 2, (height - new_h) // 2))
    return canvas


def _ensure_no_ip_adapter(pipe) -> None:
    """Unload any IP-Adapter so plain/img2img runs are unaffected."""
    global _ip_adapter_loaded
    if _ip_adapter_loaded:
        pipe.unload_ip_adapter()
        _ip_adapter_loaded = False
        # Restore the attention-slicing optimization disabled for the adapter.
        pipe.enable_attention_slicing()


def _supported_kwargs(pipe, kwargs: dict) -> dict:
    params = inspect.signature(pipe.__call__).parameters
    return {k: v for k, v in kwargs.items() if k in params and v is not None}


def _step_callback_kwargs(
    pipe,
    family: str,
    on_step: Callable[[int], None],
    on_preview: Callable[[str], None] | None = None,
) -> dict:
    """Wire ``on_step(completed_steps)`` into whichever callback API the pipeline
    exposes. Returns the kwargs to pass to ``pipe(...)``; empty if unsupported so
    generation still runs, only without live step counts.

    When ``on_preview`` is given and the model family supports it, also decode the
    step latents to a small preview (throttled) and hand the data URL to
    ``on_preview``. Preview needs the modern ``callback_on_step_end`` API with
    latents; the legacy path only reports step counts.
    """
    params = inspect.signature(pipe.__call__).parameters
    want_preview = on_preview is not None and preview_svc.supported(family)

    if "callback_on_step_end" in params:
        last_preview = [0.0]

        def _cb(_pipe, step, _timestep, cb_kwargs):  # diffusers >= 0.25 API
            on_step(step + 1)
            if want_preview:
                now = time.monotonic()
                if now - last_preview[0] >= _PREVIEW_MIN_INTERVAL_S:
                    latents = cb_kwargs.get("latents")
                    if latents is not None:
                        data_url = preview_svc.latents_to_preview(family, latents)
                        if data_url is not None:
                            on_preview(data_url)
                    last_preview[0] = now
            return cb_kwargs

        kwargs: dict = {"callback_on_step_end": _cb}
        if want_preview and "callback_on_step_end_tensor_inputs" in params:
            kwargs["callback_on_step_end_tensor_inputs"] = ["latents"]
        return kwargs

    if "callback" in params:
        def _legacy(step, _timestep, _latents):  # older diffusers API
            on_step(step + 1)

        return {"callback": _legacy, "callback_steps": 1}
    return {}


def generate(
    model: ModelInfo,
    prompt: str,
    negative_prompt: str | None,
    steps: int,
    guidance_scale: float,
    width: int,
    height: int,
    seed: int,
    sampler: str = samplers.DEFAULT_SAMPLER,
    preview: bool = False,
    init_image=None,
    reference_mode: str = "img2img",
    strength: float = 0.6,
    ip_adapter_scale: float = 0.6,
    on_step: Callable[[int], None] | None = None,
    on_preview: Callable[[str], None] | None = None,
):
    """Generate a single image, returning ``(image, effective_sampler)``.

    ``seed`` is a concrete value (resolved by the caller) so the result is
    reproducible. ``sampler`` selects the diffusers scheduler; the returned
    effective id is the one actually applied. ``on_step`` reports completed steps;
    with ``preview`` set, ``on_preview`` gets a throttled preview data URL.

    When ``init_image`` (a PIL image) is given it conditions generation:
    ``reference_mode="img2img"`` uses it as the starting point (``strength``
    controls drift); ``reference_mode="style"`` uses it as an IP-Adapter image
    prompt (``ip_adapter_scale`` controls influence, SD 1.5 / SDXL only).
    """
    if not is_downloaded(model.slug):
        raise ValueError(messages.MODEL_NOT_DOWNLOADED.format(slug=model.slug))

    import torch

    pipe = _load(model)

    use_ref = init_image is not None
    extra: dict = {}
    if use_ref and reference_mode == "img2img":
        _ensure_no_ip_adapter(pipe)
        run_pipe = _img2img(model, pipe)
        # img2img takes size from the image; fit the reference into the requested
        # size preserving aspect ratio (black padding) instead of distorting it.
        extra["image"] = _contain_pad(init_image, width, height)
        extra["strength"] = strength
    elif use_ref and reference_mode == "style":
        _ensure_ip_adapter(pipe, model)  # raises for unsupported families
        pipe.set_ip_adapter_scale(ip_adapter_scale)
        run_pipe = pipe
        extra["ip_adapter_image"] = init_image.convert("RGB")
    else:
        _ensure_no_ip_adapter(pipe)
        run_pipe = pipe

    effective_sampler = samplers.apply_sampler(run_pipe, sampler)

    generator = torch.Generator(device=get_torch_device()).manual_seed(seed)

    kwargs = _supported_kwargs(
        run_pipe,
        {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "num_inference_steps": steps,
            "guidance_scale": guidance_scale,
            "width": width,
            "height": height,
            "generator": generator,
            **extra,
        },
    )
    if on_step is not None:
        kwargs.update(
            _step_callback_kwargs(
                run_pipe,
                model.family,
                on_step,
                on_preview if preview else None,
            )
        )

    result = run_pipe(**kwargs)
    return result.images[0], effective_sampler
