"""Settings endpoints (HuggingFace token)."""
from __future__ import annotations

from fastapi import APIRouter

from ..config import Settings, load_settings, save_settings

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/settings", response_model=Settings)
def read_settings() -> Settings:
    return load_settings()


@router.post("/settings", response_model=Settings)
def update_settings(settings: Settings) -> Settings:
    return save_settings(settings)
