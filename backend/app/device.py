"""GPU/device detection and the torch backend report.

``torch`` is imported lazily so the API can still start and report a helpful
status if PyTorch has not been installed yet.
"""
from __future__ import annotations

from pydantic import BaseModel


class DeviceInfo(BaseModel):
    torch_available: bool
    backend: str  # "cuda" | "rocm" | "cpu" | "none"
    device: str  # torch device string: "cuda" | "cpu"
    gpu_name: str | None = None
    torch_version: str | None = None


def get_device_info() -> DeviceInfo:
    try:
        import torch
    except ImportError:
        return DeviceInfo(torch_available=False, backend="none", device="cpu")

    if torch.cuda.is_available():
        # ROCm PyTorch also reports cuda.is_available() == True but sets version.hip.
        is_rocm = getattr(torch.version, "hip", None) is not None
        return DeviceInfo(
            torch_available=True,
            backend="rocm" if is_rocm else "cuda",
            device="cuda",
            gpu_name=torch.cuda.get_device_name(0),
            torch_version=torch.__version__,
        )

    return DeviceInfo(
        torch_available=True,
        backend="cpu",
        device="cpu",
        torch_version=torch.__version__,
    )


def get_torch_device() -> str:
    return get_device_info().device


def get_dtype():
    """float16 on GPU, float32 on CPU."""
    import torch

    return torch.float16 if get_torch_device() == "cuda" else torch.float32


def get_compute_dtype():
    """bfloat16 on GPU, float32 on CPU — the compute dtype for GGUF FLUX.

    FLUX is trained in bfloat16 and diffusers' GGUF dequantization expects a bf16
    compute dtype, so the GGUF load path uses this instead of :func:`get_dtype`."""
    import torch

    return torch.bfloat16 if get_torch_device() == "cuda" else torch.float32


def place_offloaded(pipe):
    """Place a loaded pipe: plain .to("cpu") on CPU, else CPU-offload so encoders
    stream off the GPU during denoising (bounds peak VRAM). Returns the pipe.

    With the ``vae_on_gpu`` setting on, the VAE is excluded from the offload so it
    stays resident on the GPU (avoids the per-run CPU<->GPU move); costs a little VRAM."""
    if get_torch_device() == "cpu":
        return pipe.to("cpu")
    from .config import load_settings

    if load_settings().vae_on_gpu and getattr(pipe, "vae", None) is not None:
        # enable_model_cpu_offload honours `_exclude_from_cpu_offload` ONLY for
        # components not in `model_cpu_offload_seq` (the offload chain hooks the rest
        # first). The VAE is in that chain, so also drop it from the chain. Assign NEW
        # values (don't mutate the shared class-level attributes for every instance).
        seq = getattr(pipe, "model_cpu_offload_seq", None)
        if seq:
            pipe.model_cpu_offload_seq = "->".join(p for p in seq.split("->") if p != "vae")
        exclude = list(getattr(pipe, "_exclude_from_cpu_offload", []))
        if "vae" not in exclude:
            pipe._exclude_from_cpu_offload = exclude + ["vae"]
    pipe.enable_model_cpu_offload()
    return pipe


def make_generator(seed: int | None):
    """A seeded ``torch.Generator`` on the active device for a reproducible run, or
    None (random) when no seed is given."""
    if seed is None:
        return None
    import torch

    return torch.Generator(device=get_torch_device()).manual_seed(int(seed))


def load_gguf_pipe(model_path, gguf_filename: str, transformer_cls, pipeline_cls):
    """Build a GGUF-quantized pipe: only the transformer is quantized (from the local
    ``.gguf``); the base repo at ``model_path`` supplies VAE/text-encoders/scheduler.
    CPU-offloaded so the T5 encoder streams off the GPU (keeps peak VRAM ~16 GB).
    Shared by the FLUX Fill/Kontext engines and the generation GGUF path."""
    from diffusers import GGUFQuantizationConfig

    dtype = get_compute_dtype()
    transformer = transformer_cls.from_single_file(
        str(model_path / gguf_filename),
        config=str(model_path / "transformer"),
        quantization_config=GGUFQuantizationConfig(compute_dtype=dtype),
        torch_dtype=dtype,
    )
    pipe = pipeline_cls.from_pretrained(
        str(model_path), transformer=transformer, torch_dtype=dtype
    )
    return place_offloaded(pipe)


def load_flux2_pipe(model_path, quant_config, fits_gpu: bool):
    """Build a FLUX.2 [klein] pipe (``Flux2KleinPipeline``) in bf16.

    When ``quant_config`` is given (a ``PipelineQuantizationConfig`` from
    :func:`quantize.flux2_quant_config`) BOTH the transformer AND the 8B Qwen3 text
    encoder are bitsandbytes-quantized in the one load, so the 9B fits ~16 GB; else it
    loads full bf16. Placed by the fit verdict: resident on the GPU when it fits
    (``fits_gpu``), else CPU-offloaded (encoders stream off the GPU). Shared by the
    generation and edit-engine load paths."""
    from diffusers import Flux2KleinPipeline

    dtype = get_compute_dtype()
    kwargs: dict = {"torch_dtype": dtype}
    if quant_config is not None:
        kwargs["quantization_config"] = quant_config
    pipe = Flux2KleinPipeline.from_pretrained(str(model_path), **kwargs)

    device = get_torch_device()
    if device == "cpu" or fits_gpu:
        return pipe.to(device)
    return place_offloaded(pipe)


def load_flux_engine_pipe(
    model_path, transformer_cls, pipeline_cls, quant_cfg, *, variant, use_safetensors
):
    """Build a FLUX.1 engine pipe (Fill / Kontext — ``pipeline_cls``) from the fp16
    repo: transformer bitsandbytes-quantized when ``quant_cfg`` is given (NF4/int8 per
    the engine's effective level), else full compute-dtype; CPU-offloaded either way
    (bounds VRAM; ~16 GB at NF4). LoRA-compatible unlike GGUF. Shared by the
    inpaint-engine (Fill) and edit (Kontext) load paths."""
    if quant_cfg is not None:
        return load_quantized_pipe(
            model_path, transformer_cls, pipeline_cls, quant_cfg,
            component="transformer", family="FLUX", variant=variant,
        )
    pipe = pipeline_cls.from_pretrained(
        str(model_path), torch_dtype=get_compute_dtype(),
        variant=variant, use_safetensors=use_safetensors,
    )
    return place_offloaded(pipe)


def load_zimage_pipe(model_path, pipeline_cls, quant_cfg, fits_gpu: bool, *, use_safetensors):
    """Build a Z-Image (S3-DiT) pipe (``ZImagePipeline`` / ``ZImageInpaintPipeline``)
    in bf16. When ``quant_cfg`` is given the transformer is bitsandbytes-quantized on
    the fly so the pipe fits ~16 GB resident. Placed by the fit verdict: resident when
    ``fits_gpu``, else CPU-offloaded. Shared by the generation and inpaint-engine
    load paths."""
    from diffusers import ZImageTransformer2DModel

    dtype = get_compute_dtype()
    if quant_cfg is not None:
        transformer = ZImageTransformer2DModel.from_pretrained(
            str(model_path), subfolder="transformer",
            quantization_config=quant_cfg, torch_dtype=dtype,
        )
        pipe = pipeline_cls.from_pretrained(
            str(model_path), transformer=transformer, torch_dtype=dtype
        )
    else:
        pipe = pipeline_cls.from_pretrained(
            str(model_path), torch_dtype=dtype, use_safetensors=use_safetensors
        )

    device = get_torch_device()
    if device == "cpu" or fits_gpu:
        return pipe.to(device)
    return place_offloaded(pipe)


def load_quantized_pipe(
    model_path,
    module_cls,
    pipeline_cls,
    quant_config,
    *,
    component: str,
    family: str,
    variant: str | None = None,
):
    """Build a bitsandbytes-quantized pipe: the heavy denoising module (``component``
    = "transformer" or "unet") is loaded from the local fp16 weights + quantized on
    the fly (NF4/int8); the base repo at ``model_path`` supplies the other components.
    CPU-offloaded so encoders stream off the GPU (bounds peak VRAM). Compute dtype is
    bf16 for FLUX / SD 3.x (their trained dtype), else fp16. Shared by the generation
    and FLUX Fill/Kontext engine load paths."""
    dtype = get_compute_dtype() if family in ("FLUX", "SD 3.x") else get_dtype()
    module = module_cls.from_pretrained(
        str(model_path),
        subfolder=component,
        variant=variant,
        quantization_config=quant_config,
        torch_dtype=dtype,
    )
    # variant is needed here too: repos that ship only fp16 weights (e.g. SDXL) have
    # no non-variant VAE/encoder files, so the remaining components fail to load
    # without it. use_safetensors matches every quant-capable curated entry.
    pipe = pipeline_cls.from_pretrained(
        str(model_path),
        torch_dtype=dtype,
        variant=variant,
        use_safetensors=True,
        **{component: module},
    )
    return place_offloaded(pipe)
