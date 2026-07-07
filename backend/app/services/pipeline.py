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
from ..config import load_settings
from ..device import (
    get_compute_dtype,
    get_device_info,
    get_dtype,
    get_torch_device,
    load_flux2_pipe,
    load_gguf_pipe,
    load_quantized_pipe,
    make_generator,
)
from . import callbacks
from . import preview as preview_svc
from . import prompt_embeds
from . import quantize
from . import vram
from .downloader import is_downloaded
from .fit import assess, effective_level as fit_effective_level
from .optimizations import apply_compile, apply_perf

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
# Whether attention slicing is active on the current pipe. Slicing trades speed
# for VRAM, so it's only enabled when the model does not fully fit the GPU; the
# IP-Adapter restore path consults this so it never re-enables slicing that was
# off to begin with.
_attention_slicing = False
# LoRA adapters currently loaded on the base pipe: adapter_name (== lora slug) ->
# weight. Compared against a run's request to skip redundant reload/activation.
# Loaded on the base text2img pipe so the derived img2img pipe shares them.
_loaded_loras: dict[str, float] = {}

# Whether the stale-TunableOp-cache check has run this process (once, at first load).
_tunable_pruned = False


def _prune_stale_tunable_cache() -> None:
    """Delete on-disk TunableOp results whose recorded validators (rocBLAS / hipBLASLt
    version, GPU arch, …) differ from the current runtime. A ROCm/torch update changes
    those versions, and TunableOp then rejects the whole cache and re-tunes on EVERY
    start — deleting the stale file lets a clean re-tune persist. Runs once per process,
    before tuning is enabled. Best-effort; never fatal."""
    global _tunable_pruned
    if _tunable_pruned:
        return
    _tunable_pruned = True

    import csv

    import torch

    try:
        current = {k: v for k, v in torch.cuda.tunable.get_validators()}
    except Exception:  # noqa: BLE001 - never fatal
        return
    if not current:
        return
    # The filename env is a base path; torch appends the device ordinal (…0.csv).
    for path in config.DATA_DIR.glob("tunableop_results*.csv"):
        try:
            recorded: dict[str, str] = {}
            with open(path, newline="") as handle:
                for row in csv.reader(handle):
                    if row and row[0] == "Validator":
                        recorded[row[1]] = row[2]
            if recorded and any(current.get(k) != v for k, v in recorded.items()):
                path.unlink()
                print(f"[tunable] cleared stale cache {path.name} (ROCm version changed)")
        except OSError:
            pass

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
    # LoRA adapters live on the (now-dropped) pipe; forget them so the next load
    # re-applies from scratch.
    _loaded_loras.clear()


def _load(model: ModelInfo):
    global _current_slug, _pipeline, _attention_slicing

    if _current_slug == model.slug and _pipeline is not None:
        return _pipeline

    import torch

    # Allow TF32 on Ampere+ matmul/cudnn — a free speedup for the fp32 ops with no
    # visible quality impact. Idempotent; a no-op on CPU/older GPUs.
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

    # ROCm: tune GEMM kernels to this GPU, gated by the `tunable_ops` setting. Gated to
    # ROCm — NVIDIA's cuBLAS is already tuned. Process-global, so upscale/outpaint
    # follow too. Off → default kernels, no per-session tuning spike. Before enabling,
    # drop a stale cache (validators from an old ROCm version) so tuning re-writes under
    # the current version and persists instead of being rejected every start.
    if get_device_info().backend == "rocm":
        tune = load_settings().tunable_ops
        try:
            if tune:
                _prune_stale_tunable_cache()
            torch.cuda.tunable.enable(tune)
        except Exception:  # noqa: BLE001 - optional optimisation; never fatal
            pass

    _pipeline = None  # free the previous pipeline before loading a new one
    _reset_aux_state()
    vram.release()  # return the previous model's VRAM before loading the next

    level = effective_level(model)
    quant_cfg = quantize.quant_config(level, model.family) if level != "fp16" else None

    if model.is_gguf:
        # GGUF loads a quantized transformer and always CPU-offloads (below), so no
        # separate fit-based placement is applied.
        pipe = _load_gguf(model)
    elif model.family == "FLUX.2":
        # FLUX.2 [klein] has its own pipeline class + a DUAL-module NF4 load (transformer
        # + 8B Qwen3 text encoder), so it comes before the generic quant branch.
        pipe = _load_flux2(model, level)
    elif model.family == "Z-Image":
        # Z-Image (S3-DiT) has its own pipeline class + handles its own quant, so it
        # comes before the generic quant branch. NF4 shrinks the 6B transformer enough
        # to fit 16 GB resident (no offload shuffle); fp16 falls back to offload.
        pipe = _load_zimage(model, quant_cfg, level)
    elif quant_cfg is not None:
        # On-the-fly bitsandbytes NF4/int8: heavy module quantized, CPU-offloaded
        # (like GGUF) so encoders stream off the GPU — but LoRA-compatible.
        pipe = _load_quantized(model, quant_cfg)
    else:
        from diffusers import AutoPipelineForText2Image

        pipe = AutoPipelineForText2Image.from_pretrained(
            str(config.model_dir(model.slug)),
            torch_dtype=get_dtype(),
            variant=model.variant,
            use_safetensors=model.use_safetensors,
        )

        # Place the model per the fit verdict so the UI badge matches reality: models
        # that fit go fully on the GPU; larger ones stream weights via CPU offloading.
        device = get_torch_device()
        fits_gpu = device == "cuda" and assess(model).verdict == "fits_gpu"
        if device == "cpu" or fits_gpu:
            pipe = pipe.to(device)
        else:
            pipe.enable_model_cpu_offload()
        # channels_last is a free speedup for the conv-heavy UNet on Ampere+; skip it
        # for transformer families (SD3/FLUX expose `.transformer`, not `.unet`).
        # Best-effort: never fatal to a load.
        unet = getattr(pipe, "unet", None)
        if unet is not None:
            try:
                unet.to(memory_format=torch.channels_last)
            except Exception:  # noqa: BLE001 - optional optimisation; never fatal
                pass

    # User-configurable optimisations (VAE tiling/slicing, attention slicing, xformers,
    # torch.compile) — all best-effort. attention slicing is applied by apply_perf per
    # the setting; mirror it here so the IP-adapter restore path re-applies correctly.
    settings = load_settings()
    _attention_slicing = settings.attention_slicing
    apply_perf(pipe, settings)
    apply_compile(pipe, settings)

    _current_slug = model.slug
    _pipeline = pipe
    return pipe


def _load_gguf(model: ModelInfo):
    """Build a pipeline whose transformer is loaded from the model's GGUF file.

    Supports FLUX and SD 3.x. Only the transformer is quantized (and dequantized on
    the fly during forward); the VAE, text encoders, tokenizers and scheduler come
    from the base repo. Always uses CPU offloading so the large text encoders stream
    off the GPU during denoising, keeping peak VRAM low enough to fit ~16 GB.
    """
    if model.family == "FLUX":
        from diffusers import FluxPipeline, FluxTransformer2DModel

        TransformerCls, PipelineCls = FluxTransformer2DModel, FluxPipeline
    elif model.family == "SD 3.x":
        from diffusers import SD3Transformer2DModel, StableDiffusion3Pipeline

        TransformerCls, PipelineCls = SD3Transformer2DModel, StableDiffusion3Pipeline
    else:
        raise ValueError(messages.GGUF_UNSUPPORTED_FAMILY.format(family=model.family))

    model_path = config.model_dir(model.slug)
    return load_gguf_pipe(model_path, model.gguf_filename, TransformerCls, PipelineCls)


# family -> (heavy-module class name, subfolder/kwarg, pipeline class name) for the
# non-GGUF quantized load. Resolved from diffusers lazily in _load_quantized.
_QUANT_FAMILY = {
    "FLUX": ("FluxTransformer2DModel", "transformer", "FluxPipeline"),
    "SD 3.x": ("SD3Transformer2DModel", "transformer", "StableDiffusion3Pipeline"),
    "SDXL": ("UNet2DConditionModel", "unet", "StableDiffusionXLPipeline"),
    "SD 1.5": ("UNet2DConditionModel", "unet", "StableDiffusionPipeline"),
}


def effective_level(model: ModelInfo) -> str:
    """The load-time quantization level for ``model``: the user's stored choice if
    valid, else the auto-suggested level (highest quality that fits live VRAM). Always
    ``fp16`` for GGUF entries (they carry their own quantization)."""
    return fit_effective_level(model.slug, model.min_vram_gb, model.family, model.is_gguf)


def _load_quantized(model: ModelInfo, quant_cfg):
    """Build a pipeline whose heavy module (transformer/UNet) is bitsandbytes-quantized
    on the fly from the local fp16 weights. CPU-offloaded (bounds VRAM), LoRA-capable."""
    import diffusers

    entry = _QUANT_FAMILY.get(model.family)
    if entry is None:
        raise ValueError(messages.GGUF_UNSUPPORTED_FAMILY.format(family=model.family))
    module_name, component, pipeline_name = entry
    return load_quantized_pipe(
        config.model_dir(model.slug),
        getattr(diffusers, module_name),
        getattr(diffusers, pipeline_name),
        quant_cfg,
        component=component,
        family=model.family,
        variant=model.variant,
    )


def _load_zimage(model: ModelInfo, quant_cfg, level: str):
    """Build a Z-Image (S3-DiT) pipeline. When ``quant_cfg`` is set (NF4/int8) the
    transformer is bitsandbytes-quantized on the fly so the pipe fits 16 GB resident;
    else it loads in bf16. Placed by the fit verdict at ``level`` — resident on the
    GPU when it fits (no offload shuffle), else CPU offload."""
    from diffusers import ZImagePipeline, ZImageTransformer2DModel

    dtype = get_compute_dtype()
    model_dir = str(config.model_dir(model.slug))
    if quant_cfg is not None:
        transformer = ZImageTransformer2DModel.from_pretrained(
            model_dir, subfolder="transformer", quantization_config=quant_cfg, torch_dtype=dtype
        )
        pipe = ZImagePipeline.from_pretrained(model_dir, transformer=transformer, torch_dtype=dtype)
    else:
        pipe = ZImagePipeline.from_pretrained(
            model_dir, torch_dtype=dtype, use_safetensors=model.use_safetensors
        )

    device = get_torch_device()
    fits_gpu = device == "cuda" and assess(model, level).verdict == "fits_gpu"
    if device == "cpu" or fits_gpu:
        return pipe.to(device)
    pipe.enable_model_cpu_offload()
    return pipe


def _load_flux2(model: ModelInfo, level: str):
    """Build a FLUX.2 [klein] pipeline. At NF4/int8 (``level`` != fp16) BOTH the
    transformer and the 8B Qwen3 text encoder are bitsandbytes-quantized (the encoder
    alone nearly fills 16 GB at bf16), so the 9B fits ~16 GB resident; else full bf16.
    Placed by the fit verdict at ``level`` — resident when it fits, else CPU offload."""
    quant_cfg = quantize.flux2_quant_config(level) if level != "fp16" else None
    device = get_torch_device()
    fits_gpu = device == "cuda" and assess(model, level).verdict == "fits_gpu"
    return load_flux2_pipe(config.model_dir(model.slug), quant_cfg, fits_gpu)


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
    vram.release()  # actually return the freed VRAM to the allocator


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
        # Restore attention slicing only if it was active before the adapter
        # disabled it (full-GPU loads run without slicing).
        if _attention_slicing:
            pipe.enable_attention_slicing()


def _ensure_no_loras(pipe) -> None:
    """Unload any LoRA adapters so a plain run is unaffected."""
    if _loaded_loras:
        try:
            pipe.unload_lora_weights()
        except Exception:  # noqa: BLE001 - best-effort; state is reset regardless
            pass
        _loaded_loras.clear()


def _apply_loras(pipe, model: ModelInfo, requested: list[tuple[str, float]]) -> None:
    """Load + activate the requested LoRA adapters on ``pipe``, blended by weight.

    ``requested`` is a list of ``(lora_slug, weight)``. Each LoRA's family must match
    the base model and it must be downloaded; GGUF-quantized bases are unsupported.
    A no-op when the requested set (slugs + weights) already matches what's loaded.
    """
    from . import loras as loras_svc

    if not requested:
        _ensure_no_loras(pipe)
        return
    if model.is_gguf:
        raise ValueError(messages.LORA_GGUF_UNSUPPORTED)

    resolved: list[tuple[str, float, "object"]] = []
    for slug, weight in requested:
        info = loras_svc.get(slug)
        if info is None:
            raise ValueError(messages.LORA_NOT_FOUND.format(slug=slug))
        if info.family != model.family:
            raise ValueError(
                messages.LORA_INCOMPATIBLE.format(
                    name=info.name, lora_family=info.family, family=model.family
                )
            )
        if not is_downloaded(slug):
            raise ValueError(messages.LORA_NOT_DOWNLOADED.format(slug=slug))
        resolved.append((slug, weight, info))

    wanted = {slug: weight for slug, weight, _info in resolved}
    if wanted == _loaded_loras:
        return  # already loaded + activated with these exact weights

    # Reload from scratch: unload everything, then load + activate the wanted set.
    _ensure_no_loras(pipe)
    for slug, _weight, info in resolved:
        _load_one_lora(pipe, slug, info.filename)
    pipe.set_adapters(
        [slug for slug, _w, _i in resolved], [weight for _s, weight, _i in resolved]
    )
    _loaded_loras.update(wanted)


def _load_one_lora(pipe, slug: str, filename: str) -> None:
    """Load one LoRA onto ``pipe`` under adapter name ``slug``, resiliently.

    Some kohya-format LoRAs carry text-encoder weights that this diffusers version
    can't map back to CLIP module names (its own converter emits legacy attn-proc
    keys the peft-based text-encoder loader then fails to rank), raising an
    ``IndexError`` deep in ``get_peft_kwargs``. Fall back to loading the UNet weights
    only — the style lives in the UNet; dropping the text-encoder part just softens
    the trigger word — so the LoRA still applies instead of failing the whole run.
    """
    lora_dir = config.model_dir(slug)
    try:
        pipe.load_lora_weights(str(lora_dir), weight_name=filename, adapter_name=slug)
    except IndexError:
        # The UNet half may already be registered under ``slug``; clear it first so
        # the retry doesn't collide on the adapter name.
        try:
            pipe.delete_adapters(slug)
        except Exception:  # noqa: BLE001 - best-effort cleanup before the retry
            pass
        from safetensors.torch import load_file

        state = load_file(str(lora_dir / filename))
        unet_only = {k: v for k, v in state.items() if not k.startswith("lora_te")}
        pipe.load_lora_weights(unet_only, adapter_name=slug)


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
    want_preview = on_preview is not None and preview_svc.supported(family)
    params = inspect.signature(pipe.__call__).parameters

    # Preview needs the modern callback with the step latents; when it's wanted and
    # available, wire a custom callback. Otherwise the shared helper handles the
    # plain step-count wiring (modern or legacy API).
    if want_preview and "callback_on_step_end" in params:
        last_preview = [0.0]

        def _cb(_pipe, step, _timestep, cb_kwargs):  # diffusers >= 0.25 API
            callbacks.gpu_sync()
            on_step(step + 1)
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
        if "callback_on_step_end_tensor_inputs" in params:
            kwargs["callback_on_step_end_tensor_inputs"] = ["latents"]
        return kwargs

    return callbacks.step_kwargs(pipe, on_step)


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
    loras: list[tuple[str, float]] | None = None,
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

    # Free VRAM held by the upscaler / outpaint / edit models before generating (lazy
    # imports avoid the pipeline <-> upscale/outpaint/edit cycle; unload() empties cache).
    from . import edit as _edit
    from . import outpaint as _outpaint
    from . import upscale as _upscale

    _upscale.unload()
    _outpaint.unload()
    _edit.unload()

    import torch

    pipe = _load(model)

    # Load/activate (or clear) LoRA adapters on the base pipe before deriving the
    # img2img pipe / running, so both the plain and img2img paths pick them up.
    _apply_loras(pipe, model, loras or [])

    # Reference-image (img2img / IP-Adapter) is not wired for Z-Image / FLUX.2 yet
    # (their v1 is plain text2img); ignore any reference so the plain path always runs.
    use_ref = init_image is not None and model.family not in ("Z-Image", "FLUX.2")
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

    generator = make_generator(seed)

    # CLIP families (SD 1.5 / SDXL) truncate the prompt at 77 tokens; build long-
    # prompt / weighted embeddings and pass those instead. Best-effort: None keeps
    # the plain prompt-string path.
    prompt_kwargs: dict = {"prompt": prompt, "negative_prompt": negative_prompt}
    embeds = prompt_embeds.build(run_pipe, model.family, prompt, negative_prompt)
    if embeds is not None:
        prompt_kwargs = embeds

    kwargs = _supported_kwargs(
        run_pipe,
        {
            **prompt_kwargs,
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

    # FLUX: decode via output_type="latent" instead of letting the pipeline decode
    # inline. The full VAE decode is pathologically slow on some GPUs under CPU
    # offload — the resident quantized transformer starves the decode of VRAM so the
    # conv kernels fall back to a slow path (8-45s). Returning latents lets the
    # pipeline offload the transformer through its OWN hook first (denoise stays
    # full-speed, no hook desync), then we decode with the GPU freed (~2s at full VAE
    # quality). Other families fit the GPU / decode fast, so they keep the inline path.
    if model.family == "FLUX":
        latents = run_pipe(**kwargs, output_type="latent").images
        image = _decode_flux_latents(run_pipe, latents, width, height)
    else:
        image = run_pipe(**kwargs).images[0]
    return image, effective_sampler


def _decode_flux_latents(pipe, latents, width: int, height: int):
    """Decode FLUX latents to a PIL image, mirroring FluxPipeline's own post-denoise
    decode (unpack the packed latents, undo the scale/shift, VAE-decode, postprocess).
    Called after the pipeline has offloaded the transformer, so the VAE decode runs
    with the GPU freed."""
    import torch

    latents = pipe._unpack_latents(latents, height, width, pipe.vae_scale_factor)
    latents = (latents / pipe.vae.config.scaling_factor) + pipe.vae.config.shift_factor
    with torch.no_grad():
        image = pipe.vae.decode(latents, return_dict=False)[0]
    return pipe.image_processor.postprocess(image, output_type="pil")[0]
