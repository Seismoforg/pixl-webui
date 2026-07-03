"""System / environment information endpoint."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from .. import config
from ..device import DeviceInfo, get_device_info
from ..services import resources

router = APIRouter(prefix="/api", tags=["system"])


class SystemInfo(BaseModel):
    device: DeviceInfo
    models_dir: str


@router.get("/system", response_model=SystemInfo)
def read_system() -> SystemInfo:
    return SystemInfo(device=get_device_info(), models_dir=str(config.MODELS_DIR))


@router.get("/system/stats", response_model=resources.ResourceStats)
def read_system_stats() -> resources.ResourceStats:
    return resources.get_stats()
