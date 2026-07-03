"""Centralised, user-facing English strings.

All API-facing text lives here so it stays consistent and can later be
translated. Keep messages plain and free of internal jargon.
"""
from __future__ import annotations

# Errors
MODEL_NOT_FOUND = "Unknown model: {slug}."
MODEL_NOT_DOWNLOADED = "Model '{slug}' is not downloaded yet."
MODEL_INCOMPATIBLE = "'{repo_id}' is not a diffusers-format model and cannot be loaded."
MODEL_ALREADY_IN_CATALOG = "'{repo_id}' is already in the curated catalog."
RESOLVE_FAILED = "Could not read '{repo_id}' from HuggingFace: {detail}"
SEARCH_FAILED = "HuggingFace search failed: {detail}"
DOWNLOAD_ALREADY_RUNNING = "A download for '{slug}' is already in progress."
DOWNLOAD_FAILED = "Download of '{slug}' failed: {detail}"
GENERATION_FAILED = "Image generation failed: {detail}"
GENERATION_ALREADY_RUNNING = "A generation is already in progress."
IP_ADAPTER_UNSUPPORTED = "Style (IP-Adapter) is only available for SD 1.5 and SDXL models, not {family}."
REFERENCE_DECODE_FAILED = "Could not read the reference image."
JOB_NOT_FOUND = "Unknown generation job: {job_id}."
IMAGE_NOT_FOUND = "Unknown image: {image_id}."
SNIPPET_NOT_FOUND = "Unknown prompt snippet: {id}."
SNIPPET_INVALID_KIND = "Invalid snippet kind: {kind}."
NO_TORCH = "PyTorch is not installed. Run install.ps1 first."

# Status / info
DOWNLOAD_STARTED = "Download of '{slug}' started."
GATED_MODEL_HINT = "This model is gated; add a HuggingFace token in Settings to download it."
