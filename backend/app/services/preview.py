"""Live step previews via a tiny approximate decoder (TAESD).

Decoding the full VAE on every denoising step would roughly double generation
time, so live previews use TAESD (``madebyollin/taesd*``), a ~5 MB autoencoder
that turns latents into a rough RGB image in milliseconds. The decoder is cached
per model family and placed on the torch device.

Only SD 1.5 and SDXL are decoded for now: their latents are ordinary 4-D
``(B, C, H, W)`` tensors on the well-established 0.18215 scaling. SD 3.x and FLUX
carry different latent conventions (FLUX latents are packed into a sequence) and
are treated as "no preview" — ``latents_to_preview`` returns ``None`` and
generation is never affected.
"""
from __future__ import annotations

import base64
import io

from ..device import get_dtype, get_torch_device

# family -> TAESD repo. Only entries we actually decode are listed; other
# families simply have no preview.
_TAESD_REPO = {
    "SD 1.5": "madebyollin/taesd",
    "SDXL": "madebyollin/taesdxl",
}

# Long-edge size of the emitted preview JPEG.
_PREVIEW_MAX_PX = 256

_decoders: dict[str, object] = {}


def _get_decoder(family: str):
    """Return a cached ``AutoencoderTiny`` for ``family`` or ``None`` if the
    family is unsupported or the decoder can't be loaded."""
    repo = _TAESD_REPO.get(family)
    if repo is None:
        return None
    if family in _decoders:
        return _decoders[family]

    try:
        from diffusers import AutoencoderTiny

        decoder = AutoencoderTiny.from_pretrained(repo, torch_dtype=get_dtype())
        decoder = decoder.to(get_torch_device())
    except Exception:  # noqa: BLE001 - preview is best-effort; never break generation
        _decoders[family] = None
        return None

    _decoders[family] = decoder
    return decoder


def supported(family: str) -> bool:
    return family in _TAESD_REPO


def latents_to_preview(family: str, latents) -> str | None:
    """Decode ``latents`` to a small JPEG ``data:`` URL, or ``None`` on any
    failure / unsupported family. Best-effort: exceptions are swallowed so a
    preview problem never affects the running generation."""
    decoder = _get_decoder(family)
    if decoder is None:
        return None

    try:
        import torch
        from PIL import Image

        # Only ordinary 4-D image latents are handled; packed latents (FLUX) or
        # unexpected shapes are skipped rather than decoded into garbage.
        if getattr(latents, "ndim", 0) != 4:
            return None

        device = next(decoder.parameters()).device
        with torch.no_grad():
            lat = latents.to(device=device, dtype=decoder.dtype) / decoder.config.scaling_factor
            sample = decoder.decode(lat, return_dict=False)[0]

        sample = (sample / 2 + 0.5).clamp(0, 1)
        # First image of the batch, CHW float -> HWC uint8.
        arr = sample[0].permute(1, 2, 0).mul(255).round().to(torch.uint8).cpu().numpy()
        img = Image.fromarray(arr)
        img.thumbnail((_PREVIEW_MAX_PX, _PREVIEW_MAX_PX))

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        data = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{data}"
    except Exception:  # noqa: BLE001 - best-effort preview
        return None
