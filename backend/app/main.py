"""FastAPI application entry point.

Run with: ``uvicorn app.main:app`` from the ``backend`` directory.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .routers import (
    edit,
    generate,
    images,
    inpaint,
    models,
    reframe,
    settings,
    system,
    templates,
    upscale,
    ws,
)

config.ensure_dirs()

app = FastAPI(title="Pixl WebUI", version="0.1.0")

# The frontend dev/prod server runs on localhost:3000.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(settings.router)
app.include_router(models.router)
app.include_router(generate.router)
app.include_router(images.router)
app.include_router(templates.router)
app.include_router(upscale.router)
app.include_router(reframe.router)
app.include_router(inpaint.router)
app.include_router(edit.router)
app.include_router(ws.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
