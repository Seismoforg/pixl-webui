"""Persistent gallery of generated images.

Each generated image is stored under ``outputs/`` as a PNG plus a JSON sidecar
holding its generation metadata (prompt, model, settings, seed, timestamp).
Listing globs the sidecars; deletion removes both files.
"""
from __future__ import annotations

import threading
from datetime import datetime

from pydantic import BaseModel

from .. import config

# A monotonically increasing counter makes ids unique within a process even when
# two images are saved in the same second. Guarded by the module lock.
_counter = 0
_lock = threading.Lock()


class ImageMeta(BaseModel):
    """Metadata persisted alongside a generated image."""

    id: str
    created: str  # ISO-8601 timestamp
    model_slug: str
    model_name: str
    prompt: str
    negative_prompt: str | None = None
    steps: int
    guidance_scale: float
    width: int
    height: int
    seed: int
    # Effective sampler id (e.g. "dpmpp_2m_karras"). Defaults to "default" for
    # images generated before samplers were selectable.
    sampler: str = "default"


def _new_id() -> str:
    global _counter
    with _lock:
        _counter += 1
        counter = _counter
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{counter:04d}"


def _png_path(image_id: str):
    return config.OUTPUTS_DIR / f"{image_id}.png"


def _meta_path(image_id: str):
    return config.OUTPUTS_DIR / f"{image_id}.json"


def save(image, meta_fields: dict) -> ImageMeta:
    """Persist a PIL ``image`` and its metadata, returning the stored metadata."""
    config.ensure_dirs()
    image_id = _new_id()
    meta = ImageMeta(
        id=image_id,
        created=datetime.now().isoformat(timespec="seconds"),
        **meta_fields,
    )
    image.save(_png_path(image_id), format="PNG")
    _meta_path(image_id).write_text(meta.model_dump_json(indent=2), "utf-8")
    return meta


def list_all() -> list[ImageMeta]:
    """Return all stored image metadata, newest first."""
    if not config.OUTPUTS_DIR.exists():
        return []
    metas: list[ImageMeta] = []
    for path in config.OUTPUTS_DIR.glob("*.json"):
        try:
            metas.append(ImageMeta.model_validate_json(path.read_text("utf-8")))
        except (ValueError, OSError):
            continue  # skip corrupt/partial sidecars
    metas.sort(key=lambda m: m.created, reverse=True)
    return metas


def get(image_id: str) -> ImageMeta | None:
    """Return metadata for ``image_id`` or ``None``."""
    path = _meta_path(image_id)
    if not path.exists():
        return None
    try:
        return ImageMeta.model_validate_json(path.read_text("utf-8"))
    except (ValueError, OSError):
        return None


def file_path(image_id: str):
    """Path to the PNG for ``image_id`` if it exists, else ``None``."""
    path = _png_path(image_id)
    return path if path.exists() else None


def decode_data_url(data_url: str, error: str):
    """Decode a base64 image data URL to a PIL image, raising ``ValueError(error)``
    on malformed input. Shared by the generate/upscale routers so image decoding
    lives in the service layer rather than the controllers."""
    import base64
    import binascii
    import io

    from PIL import Image

    payload = data_url.split(",", 1)[1] if "," in data_url else data_url
    try:
        raw = base64.b64decode(payload)
        return Image.open(io.BytesIO(raw))
    except (binascii.Error, ValueError, OSError) as exc:
        raise ValueError(error) from exc


def delete(image_id: str) -> bool:
    """Delete the PNG and sidecar for ``image_id``. Returns False if unknown."""
    png, meta = _png_path(image_id), _meta_path(image_id)
    if not meta.exists() and not png.exists():
        return False
    png.unlink(missing_ok=True)
    meta.unlink(missing_ok=True)
    return True
