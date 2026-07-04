"""Gallery endpoints: list stored images, serve a PNG, delete an image."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import messages
from ..services import gallery

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get("", response_model=list[gallery.ImageMeta])
def list_images() -> list[gallery.ImageMeta]:
    return gallery.list_all()


@router.get("/{image_id}", response_model=gallery.ImageMeta)
def image_meta(image_id: str) -> gallery.ImageMeta:
    meta = gallery.get(image_id)
    if meta is None:
        raise HTTPException(404, messages.IMAGE_NOT_FOUND.format(image_id=image_id))
    return meta


@router.get("/{image_id}/file")
def image_file(image_id: str) -> FileResponse:
    path = gallery.file_path(image_id)
    if path is None:
        raise HTTPException(404, messages.IMAGE_NOT_FOUND.format(image_id=image_id))
    return FileResponse(path, media_type="image/png")


@router.delete("/{image_id}")
def delete_image(image_id: str) -> dict[str, str]:
    if not gallery.delete(image_id):
        raise HTTPException(404, messages.IMAGE_NOT_FOUND.format(image_id=image_id))
    return {"id": image_id, "status": "deleted"}
