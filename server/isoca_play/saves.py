"""One saved game of each kind: GET returns it (or 204), PUT replaces it.

The body is an opaque JSON object; the server only checks that it is one and that
it is small. Only a signed-in session reaches these routes, and a PUT must also
pass the Origin check: both are the guard's (auth.require_session), not repeated
here.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from . import db
from .config import Settings

GAMES = frozenset({"mahjong", "solitaire", "sudoku"})
MAX_BODY = 512 * 1024
NO_STORE = {"Cache-Control": "no-store"}

router = APIRouter()


def refuse(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status, headers=NO_STORE)


async def read_body(request: Request) -> bytes | None:
    """The whole body, or None once it passes MAX_BODY. Counted as it arrives:
    Content-Length may be missing (chunked) or wrong."""
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BODY:
        return None
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_BODY:
            return None
    return bytes(body)


def _refuse_constant(name: str):
    raise ValueError(name)  # NaN and Infinity are not JSON


def parse_object(raw: bytes) -> str | None:
    """The body as text if it is a JSON object, else None."""
    try:
        text = raw.decode("utf-8")
        value = json.loads(text, parse_constant=_refuse_constant)
    except (ValueError, RecursionError):  # UnicodeDecodeError is a ValueError
        return None
    return text if isinstance(value, dict) else None


def _store(settings: Settings, game: str, text: str) -> None:
    conn = db.connect(settings.db_path)
    try:
        conn.execute(
            "INSERT INTO save (game, body, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(game) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
            (game, text, settings.now()),
        )
    finally:
        conn.close()


def _load(settings: Settings, game: str) -> str | None:
    conn = db.connect(settings.db_path)
    try:
        row = conn.execute("SELECT body FROM save WHERE game = ?", (game,)).fetchone()
    finally:
        conn.close()
    return row[0] if row else None


@router.get("/api/save/{game}")
def get_save(game: str, request: Request) -> Response:
    if game not in GAMES:
        return refuse(404, "No such game")
    body = _load(request.app.state.settings, game)
    if body is None:
        return Response(status_code=204, headers=NO_STORE)
    return Response(body, media_type="application/json", headers=NO_STORE)


@router.put("/api/save/{game}")
async def put_save(game: str, request: Request) -> Response:
    if game not in GAMES:
        return refuse(404, "No such game")
    raw = await read_body(request)
    if raw is None:
        return refuse(413, "Too large")
    text = parse_object(raw)
    if text is None:
        return refuse(400, "The body must be a JSON object")
    await run_in_threadpool(_store, request.app.state.settings, game, text)
    return Response(status_code=204, headers=NO_STORE)


def install(app: FastAPI) -> None:
    app.include_router(router)
