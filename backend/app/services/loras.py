"""Registry of available LoRA adapters (domain data).

A LoRA is a small weight file that biases a base model toward a style/subject/
concept without a full fine-tuned checkpoint. Each entry is family-scoped (only
applies to matching base models) and downloads its single ``.safetensors`` file
into ``models/<slug>`` via the existing single-file download machinery.

JSON-backed like the model/engine catalogs: ``loras_catalog.json`` next to the app
package ships the default, and a git-ignored ``data/loras_catalog.json`` override
(written by the Settings editor) fully replaces it. An unreadable/invalid override
silently falls back to the bundled default.
"""
from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, TypeAdapter

from ..config import DATA_DIR, ensure_dirs


class LoraInfo(BaseModel):
    slug: str
    # HuggingFace repo id. Empty for a Civitai-sourced LoRA (see ``civitai_version_id``).
    repo_id: str = ""
    filename: str  # the single .safetensors weight to fetch + load
    name: str
    family: str  # "SD 1.5" | "SDXL" | "FLUX" | "FLUX.2" — must match the base model to apply
    # Civitai model-version id. When set, the weight is downloaded from civitai.com
    # (single-file, needs the ``civitai_token`` setting) instead of HuggingFace.
    civitai_version_id: int | None = None
    description: str = ""
    # Broad category shown as a badge in the UI. One of: style | character | concept
    # | realism | accelerator | other. Defaults to "other" so pre-existing overrides
    # (which lack the field) stay valid.
    kind: str = "other"
    # Optional trigger word(s) to add to the prompt for this LoRA to take effect.
    trigger: str | None = None
    approx_size_gb: float = 0.0


DEFAULT_CATALOG_FILE = Path(__file__).parents[1] / "loras_catalog.json"
OVERRIDE_CATALOG_FILE = DATA_DIR / "loras_catalog.json"

_CATALOG_ADAPTER = TypeAdapter(list[LoraInfo])


def default_catalog() -> list[LoraInfo]:
    """The bundled default LoRA catalog shipped with the app."""
    return _CATALOG_ADAPTER.validate_json(DEFAULT_CATALOG_FILE.read_text("utf-8"))


def load_catalog() -> list[LoraInfo]:
    """Return the active LoRA catalog: the user override if present and valid, else
    the bundled default (also the fallback for an invalid override)."""
    if OVERRIDE_CATALOG_FILE.exists():
        try:
            return _CATALOG_ADAPTER.validate_json(OVERRIDE_CATALOG_FILE.read_text("utf-8"))
        except (ValueError, OSError):
            return default_catalog()
    return default_catalog()


def save_catalog(loras: list[LoraInfo]) -> list[LoraInfo]:
    """Persist ``loras`` as the user override and return the stored value."""
    ensure_dirs()
    OVERRIDE_CATALOG_FILE.write_text(
        json.dumps([lora.model_dump() for lora in loras], indent=2), "utf-8"
    )
    return loras


def reset_catalog() -> list[LoraInfo]:
    """Drop the user override so the bundled default takes effect again."""
    OVERRIDE_CATALOG_FILE.unlink(missing_ok=True)
    return default_catalog()


def all_loras() -> list[LoraInfo]:
    """The active LoRA catalog."""
    return load_catalog()


def get(slug: str) -> LoraInfo | None:
    """Return the LoRA for ``slug`` from the active catalog, or ``None``."""
    return next((lora for lora in load_catalog() if lora.slug == slug), None)


def clear_loras(pipe, loaded: dict[str, float]) -> None:
    """Unload any active adapters so a plain run is unaffected (best-effort);
    ``loaded`` (the caller's adapter-state dict) is reset regardless."""
    if not loaded:
        return
    try:
        pipe.unload_lora_weights()
    except Exception:  # noqa: BLE001 - best-effort; state is reset regardless
        pass
    loaded.clear()


def apply_lora_set(
    pipe,
    family: str,
    is_gguf: bool,
    requested: list[tuple[str, float]],
    loaded: dict[str, float],
    load_one=None,
) -> None:
    """Validate + blend the ``(slug, weight)`` LoRA set onto ``pipe`` — the shared
    core of the generation and edit services. Each LoRA must exist, match ``family``
    and be downloaded; GGUF bases are unsupported. ``loaded`` is the caller's
    adapter-state dict (mutated to match); a no-op when the wanted set already equals
    it. ``load_one(pipe, slug, filename)`` overrides the plain single-LoRA load
    (generation passes its kohya-resilient loader)."""
    from .. import messages
    from ..config import model_dir
    from .downloader import is_downloaded

    if not requested:
        clear_loras(pipe, loaded)
        return
    if is_gguf:
        raise ValueError(messages.LORA_GGUF_UNSUPPORTED)

    resolved: list[tuple[str, float, LoraInfo]] = []
    for slug, weight in requested:
        info = get(slug)
        if info is None:
            raise ValueError(messages.LORA_NOT_FOUND.format(slug=slug))
        if info.family != family:
            raise ValueError(
                messages.LORA_INCOMPATIBLE.format(
                    name=info.name, lora_family=info.family, family=family
                )
            )
        if not is_downloaded(slug):
            raise ValueError(messages.LORA_NOT_DOWNLOADED.format(slug=slug))
        resolved.append((slug, weight, info))

    wanted = {slug: weight for slug, weight, _info in resolved}
    if wanted == loaded:
        return  # already loaded + activated with these exact weights

    # Reload from scratch: unload everything, then load + activate the wanted set.
    clear_loras(pipe, loaded)
    for slug, _weight, info in resolved:
        if load_one is not None:
            load_one(pipe, slug, info.filename)
        else:
            pipe.load_lora_weights(
                str(model_dir(slug)), weight_name=info.filename, adapter_name=slug
            )
    pipe.set_adapters(
        [slug for slug, _w, _i in resolved], [weight for _s, weight, _i in resolved]
    )
    loaded.update(wanted)
