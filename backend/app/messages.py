"""Centralised, user-facing English strings.

All API-facing text lives here so it stays consistent and can later be
translated. Keep messages plain and free of internal jargon.
"""
from __future__ import annotations

# Errors
MODEL_NOT_FOUND = "Unknown model: {slug}."
MODEL_NOT_DOWNLOADED = "Model '{slug}' is not downloaded yet."
CATALOG_DUPLICATE_SLUG = "Duplicate slug '{slug}' — each entry needs a unique slug."
DOWNLOAD_ALREADY_RUNNING = "A download for '{slug}' is already in progress."
GENERATION_FAILED = "Image generation failed: {detail}"
GENERATION_ALREADY_RUNNING = "A generation is already in progress."
IP_ADAPTER_UNSUPPORTED = "Style (IP-Adapter) is only available for SD 1.5 and SDXL models, not {family}."
GGUF_UNSUPPORTED_FAMILY = "GGUF-quantized loading is only supported for FLUX models, not {family}."
REFERENCE_DECODE_FAILED = "Could not read the reference image."
JOB_NOT_FOUND = "Unknown generation job: {job_id}."
IMAGE_NOT_FOUND = "Unknown image: {image_id}."
UPSCALER_NOT_FOUND = "Unknown upscaler: {slug}."
OUTPAINT_ENGINE_INVALID = "'{slug}' is not an outpaint (inpaint) model."
UPSCALE_FAILED = "Upscaling failed: {detail}"
UPSCALE_ALREADY_RUNNING = "An upscale is already in progress."
UPSCALE_SOURCE_MISSING = "No source image to upscale — pick a gallery image or upload one."
OUTPAINT_MODEL_MISSING = "The outpaint model isn't downloaded yet — download it first."
REFRAME_FAILED = "Reframing failed: {detail}"
REFRAME_ALREADY_RUNNING = "A reframe is already in progress."
REFRAME_SOURCE_MISSING = "No source image to reframe — pick a gallery image or upload one."
REFRAME_RATIO_REQUIRED = "Pick a target aspect ratio to reframe to."
SNIPPET_NOT_FOUND = "Unknown prompt snippet: {id}."
SNIPPET_INVALID_KIND = "Invalid snippet kind: {kind}."

# Status / info
DOWNLOAD_STARTED = "Download of '{slug}' started."
