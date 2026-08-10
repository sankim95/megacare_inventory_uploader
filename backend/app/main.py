from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect

from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.api.documents import router as documents_router
from app.api.matching import router as matching_router
from app.api.exports import router as exports_router
from app.core.config import Settings, get_settings
from app.core.database import build_engine, build_session_factory
from app.services.recovery import recover_interrupted_extractions


def mount_frontend(app: FastAPI, dist_dir: Path) -> None:
    index_path = dist_dir / "index.html"
    if not index_path.is_file():
        return

    assets_dir = dist_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API 경로를 찾을 수 없습니다.")

        candidate = (dist_dir / full_path).resolve()
        if candidate.is_relative_to(dist_dir.resolve()) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_path)


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    app_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        app_settings.ensure_data_directories()
        recovery_engine = build_engine(app_settings.resolved_database_url)
        try:
            if inspect(recovery_engine).has_table("documents"):
                recovery_session_factory = build_session_factory(recovery_engine)
                with recovery_session_factory() as session:
                    recover_interrupted_extractions(
                        session, app_settings.data_dir / "exports"
                    )
        finally:
            recovery_engine.dispose()
        yield

    app = FastAPI(
        title=app_settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def request_validation_error_handler(
        _: Request, __: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"detail": "요청 형식을 확인해 주세요."},
        )

    app.include_router(health_router, prefix="/api")
    app.include_router(jobs_router, prefix="/api")
    app.include_router(documents_router, prefix="/api")
    app.include_router(matching_router, prefix="/api")
    app.include_router(exports_router, prefix="/api")
    mount_frontend(app, app_settings.frontend_dist)
    return app


app = create_app()
