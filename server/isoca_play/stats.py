"""One record per finished game, and the totals worked out from them.

Sending a record needs a session and passes the Origin check, both the guard's
(auth.require_session), and the app's stats route needs a session. Nothing here gives
out a date without one.
"""

from __future__ import annotations

import json
from datetime import date

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from . import db, mahjong, saves
from .config import Settings

LEVELS = ("easy", "medium", "hard")
MAX_ID = 64
MAX_COUNT = 1_000_000
MAX_SECONDS = 30 * 24 * 60 * 60
MAX_DAYS = 400

router = APIRouter()


def _is_day(value: object) -> bool:
    # fromisoformat also takes other shapes on newer Pythons, so the length is held too.
    if not isinstance(value, str) or len(value) != 10:
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _is_count(value: object, limit: int = MAX_COUNT) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= limit


def _is_count_or_none(value: object) -> bool:
    return value is None or _is_count(value)


def validate_record(body: dict) -> dict | None:
    """The record, cleaned to its known fields, or None if any of them is wrong."""
    id_, game, level, result = (body.get(k) for k in ("id", "game", "level", "result"))
    map_id, slots, days = (body.get(k) for k in ("map", "slots", "days"))
    if not isinstance(id_, str) or not 1 <= len(id_) <= MAX_ID:
        return None
    if game not in saves.GAMES:
        return None
    if result not in ("won", "abandoned") and not (result == "lost" and game == "mahjong"):
        return None
    if (level is None) != (game == "solitaire") or (level is not None and level not in LEVELS):
        return None
    if game == "mahjong":
        if map_id not in mahjong._LAYOUT_BY_ID or not isinstance(slots, bool):
            return None
    elif map_id is not None or slots is not None:
        return None
    if not _is_day(body.get("day")) or not isinstance(days, list) or len(days) > MAX_DAYS:
        return None
    if not all(_is_day(d) for d in days):
        return None
    if not _is_count(body.get("seconds"), MAX_SECONDS):
        return None
    if not _is_count(body.get("returns")) or not _is_count(body.get("tips")):
        return None
    if not all(_is_count_or_none(body.get(k)) for k in ("moves", "unsolved", "turns")):
        return None
    return {
        "id": id_,
        "game": game,
        "level": level,
        "result": result,
        "day": body["day"],
        "days": json.dumps(days),
        "seconds": body["seconds"],
        "returns": body["returns"],
        "tips": body["tips"],
        "map": map_id,
        "slots": slots,
        "moves": body.get("moves"),
        "unsolved": body.get("unsolved"),
        "turns": body.get("turns"),
    }


def _store(settings: Settings, row: dict) -> None:
    conn = db.connect(settings.db_path)
    try:
        conn.execute(
            "INSERT OR IGNORE INTO game_record "
            "(id, game, level, result, day, days, seconds, returns, tips, map, slots, moves, unsolved, turns) "
            "VALUES (:id, :game, :level, :result, :day, :days, :seconds, :returns, :tips, :map, :slots, :moves, :unsolved, :turns)",
            row,
        )
    finally:
        conn.close()


@router.post("/api/stats/game")
async def post_game(request: Request) -> Response:
    raw = await saves.read_body(request)
    if raw is None:
        return saves.refuse(413, "Too large")
    text = saves.parse_object(raw)
    row = validate_record(json.loads(text)) if text is not None else None
    if row is None:
        return saves.refuse(400, "Not a game record")
    await run_in_threadpool(_store, request.app.state.settings, row)
    return Response(status_code=204, headers=saves.NO_STORE)


def install(app: FastAPI) -> None:
    app.include_router(router)
