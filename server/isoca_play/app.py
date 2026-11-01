"""The FastAPI application."""

from __future__ import annotations

import sqlite3
from typing import Iterator

from fastapi import Depends, FastAPI, Request

from . import auth, db, saves
from .config import Settings


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
    auth.install(app)

    @app.get("/healthz")
    def healthz() -> dict:
        return {"version": settings.version}

    return app
