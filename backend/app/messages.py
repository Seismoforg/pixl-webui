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
# One heavy GPU job (generation/upscale/reframe/inpaint/edit) at a time — see job_guard.
JOB_BUSY = "A {kind} job is already running — wait for it to finish."
GENERATION_FAILED = "Image generation failed: {detail}"
IP_ADAPTER_UNSUPPORTED = "Style (IP-Adapter) is only available for SD 1.5 and SDXL models, not {family}."
GGUF_UNSUPPORTED_FAMILY = "GGUF-quantized loading is only supported for FLUX and SD 3.x models, not {family}."
REFERENCE_DECODE_FAILED = "Could not read the reference image."
SOURCE_DECODE_FAILED = "Could not read the source image — it may be corrupt or not an image."
JOB_NOT_FOUND = "Unknown job: {job_id}."
IMAGE_NOT_FOUND = "Unknown image: {image_id}."
UPSCALER_NOT_FOUND = "Unknown upscaler: {slug}."
OUTPAINT_ENGINE_INVALID = "'{slug}' is not an outpaint (inpaint) model."
UPSCALE_FAILED = "Upscaling failed: {detail}"
UPSCALE_SOURCE_MISSING = "No source image to upscale — pick a gallery image or upload one."
OUTPAINT_MODEL_MISSING = "The outpaint model isn't downloaded yet — download it first."
REFRAME_FAILED = "Reframing failed: {detail}"
REFRAME_SOURCE_MISSING = "No source image to reframe — pick a gallery image or upload one."
REFRAME_RATIO_REQUIRED = "Pick a target aspect ratio to reframe to."
REFRAME_SIZE_INVALID = "Enter both a width and a height (64–4096 px) for a custom resolution."
INPAINT_FAILED = "Inpainting failed: {detail}"
INPAINT_SOURCE_MISSING = "No source image to inpaint — pick a gallery image or upload one."
INPAINT_MASK_MISSING = "Paint a mask on the image before inpainting."
INPAINT_MASK_EMPTY = "The painted mask is empty — paint the area you want to change."
INPAINT_ENGINE_INVALID = "'{slug}' is not an inpaint model."
INPAINT_MODEL_MISSING = "The inpaint model isn't downloaded yet — download it first."
EDIT_FAILED = "Image editing failed: {detail}"
EDIT_SOURCE_MISSING = "No source image to edit — pick a gallery image or upload one."
EDIT_PROMPT_REQUIRED = "Describe the change you want — enter an instruction first."
EDIT_ENGINE_INVALID = "'{slug}' is not an edit model."
EDIT_MODEL_MISSING = "The edit model isn't downloaded yet — download it first."
SNIPPET_NOT_FOUND = "Unknown prompt snippet: {id}."
SNIPPET_INVALID_KIND = "Invalid snippet kind: {kind}."

# Status / info
DOWNLOAD_STARTED = "Download of '{slug}' started."
