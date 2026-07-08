"""FastAPI application entry point.

Run with: ``uvicorn app.main:app`` from the ``backend`` directory.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .services import jobs
from .routers import (
    compare,
    edit,
    generate,
    images,
    inpaint,
    loras,
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

# jobs.start_job raises JobBusy (a service can't raise HTTPException — layering);
# map it centrally to the 409 every job router used to raise inline.
@app.exception_handler(jobs.JobBusy)
def job_busy_handler(_request: Request, exc: jobs.JobBusy) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


app.include_router(system.router)
app.include_router(settings.router)
app.include_router(models.router)
app.include_router(loras.router)
app.include_router(generate.router)
app.include_router(compare.router)
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
