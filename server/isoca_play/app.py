"""The FastAPI application."""

from __future__ import annotations

import sqlite3
from pathlib import PurePath
from typing import Iterator

from fastapi import Depends, FastAPI, Request
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope

from . import auth, db, mahjong, saves, sudoku
from .config import Settings, from_env

# Hashed names never change their content. Everything else, the entry page and the
# worker included, is asked about every time, so a new release is seen at the next load.
IMMUTABLE = "private, max-age=31536000, immutable"
REVALIDATE = "no-cache"


class _Build(StaticFiles):
    """The built frontend. A missing build is a 404 for its paths, so the health check
    and login still answer, where StaticFiles would raise on every request."""

    async def check_config(self) -> None:
        pass

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        if response.status_code in (200, 304):
            hashed = PurePath(path).parts[:1] == ("assets",)
            response.headers["Cache-Control"] = IMMUTABLE if hashed else REVALIDATE
        return response


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(settings: Settings = Depends(get_settings)) -> Iterator[sqlite3.Connection]:
    """One connection per request, closed when the request ends."""
    conn = db.connect(settings.db_path)
    try:
        yield conn
    finally:
        conn.close()


def create_app(settings: Settings) -> FastAPI:
    # Private site: no public API docs or schema.
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    saves.install(app)
    mahjong.install(app)
    sudoku.install(app)
    auth.install(app)

    @app.get("/healthz")
    def healthz() -> dict:
        return {"version": settings.version}

    # Last, so every route above answers first; the guard stands in front of all of it.
    # StaticFiles resolves each path and refuses what lands outside static_dir, and it
    # follows no symlink out. html=True is what serves index.html at /.
    app.mount("/", _Build(directory=settings.static_dir, html=True, check_dir=False))

    return app


def app_from_env() -> FastAPI:
    """What the image runs: `uvicorn --factory isoca_play.app:app_from_env`."""
    return create_app(from_env())
