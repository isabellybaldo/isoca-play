"""One record per finished game, and the totals worked out from them.

Sending a record needs a session and passes the Origin check, both the guard's
(auth.require_session), and the app's stats route needs a session. Nothing here gives
out a date without one.
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from datetime import date, timedelta

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from . import db, mahjong, saves
from .config import Settings

LEVELS = ("easy", "medium", "hard")
MAX_ID = 64
MAX_COUNT = 1_000_000
MAX_SECONDS = 30 * 24 * 60 * 60
MAX_DAYS = 400
DAILY_SPAN = 30

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


# Totals


def _rows(conn: sqlite3.Connection) -> list[dict]:
    names = ("game", "level", "result", "day", "days", "seconds", "returns", "tips", "map")
    query = f"SELECT {', '.join(names)} FROM game_record"
    return [dict(zip(names, row)) for row in conn.execute(query)]


def _average(values: list[int]) -> int | None:
    return round(sum(values) / len(values)) if values else None


def _count(rows: list[dict]) -> dict:
    """What a game, a level and a map all report. A time counts wins only."""
    wins = [r["seconds"] for r in rows if r["result"] == "won"]
    return {
        "played": len(rows),
        "won": len(wins),
        "win_rate": round(100 * len(wins) / len(rows)) if rows else None,
        "avg_win_seconds": _average(wins),
        "best_win_seconds": min(wins) if wins else None,
    }


def _ended(rows: list[dict]) -> dict:
    return {
        "lost": sum(r["result"] == "lost" for r in rows),
        "abandoned": sum(r["result"] == "abandoned" for r in rows),
    }


def _days_played(rows: list[dict]) -> set[date]:
    return {date.fromisoformat(d) for r in rows for d in json.loads(r["days"])}


def _longest_streak(days: set[date]) -> int:
    longest = 0
    for day in days:
        if day - timedelta(days=1) in days:
            continue  # counted from the start of its run
        length = 1
        while day + timedelta(days=length) in days:
            length += 1
        longest = max(longest, length)
    return longest


def public_totals(conn: sqlite3.Connection) -> dict | None:
    """Everything anyone may read, or None with no records. It must never hold a date."""
    rows = _rows(conn)
    if not rows:
        return None
    games = []
    for game in sorted(saves.GAMES):
        of_game = [r for r in rows if r["game"] == game]
        if not of_game:
            continue
        levels = [
            {"level": level, **_count(of_level)}
            for level in LEVELS
            if (of_level := [r for r in of_game if r["level"] == level])
        ]
        games.append(
            {
                "game": game,
                **_count(of_game),
                **_ended(of_game),
                "avg_returns": _average([r["returns"] for r in of_game]),
                "avg_tips": _average([r["tips"] for r in of_game]),
                "levels": levels,
            }
        )
    maps = [
        {"map": map_id, "name": mahjong._LAYOUT_BY_ID[map_id]["name"], **_count(of_map), **_ended(of_map)}
        for map_id in mahjong._LAYOUT_BY_ID
        if (of_map := [r for r in rows if r["map"] == map_id])
    ]
    maps.sort(key=lambda m: -m["played"])
    return {"games": games, "maps": maps, "longest_streak": _longest_streak(_days_played(rows))}


def private_totals(conn: sqlite3.Connection, today: date) -> dict:
    """What involves dates, for the signed-in app only."""
    rows = _rows(conn)
    finished = Counter(r["day"] for r in rows)
    span = [today - timedelta(days=back) for back in range(DAILY_SPAN - 1, -1, -1)]
    days = _days_played(rows)
    # A streak still stands on a day with nothing played yet.
    end = today if today in days else today - timedelta(days=1)
    current = 0
    while end - timedelta(days=current) in days:
        current += 1
    return {
        "daily": [{"day": d.isoformat(), "games": finished[d.isoformat()]} for d in span],
        "current_streak": current,
    }


def _both(settings: Settings, today: date) -> dict:
    conn = db.connect(settings.db_path)
    try:
        return {"public": public_totals(conn), "private": private_totals(conn, today)}
    finally:
        conn.close()


@router.get("/api/stats")
def get_stats(request: Request, today: str = "") -> Response:
    settings: Settings = request.app.state.settings
    day = date.fromisoformat(today) if _is_day(today) else date.fromtimestamp(settings.now())
    return JSONResponse(_both(settings, day), headers=saves.NO_STORE)


def install(app: FastAPI) -> None:
    app.include_router(router)
