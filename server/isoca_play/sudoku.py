"""New sudoku games: POST /api/new/sudoku gives a puzzle of a level from the pack.

Only a signed-in session reaches the route, and it must also pass the Origin check:
both are the guard's (auth.require_session), not repeated here.

data/sudoku_pack.json is written ahead of time by tools/make_sudoku_pack.py, which
sets each level by the rules a board needs. The grader stays out of the server.
"""

from __future__ import annotations

import json
import secrets
from pathlib import Path

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse, Response

from . import saves

LEVELS = ("easy", "medium", "hard")
PACK: dict[str, list[dict[str, str]]] = json.loads(
    (Path(__file__).parent / "data" / "sudoku_pack.json").read_text(encoding="utf-8")
)

router = APIRouter()


@router.post("/api/new/sudoku")
async def new_sudoku(request: Request) -> Response:
    raw = await saves.read_body(request)
    if raw is None:
        return saves.refuse(413, "Too large")
    text = saves.parse_object(raw)
    body = json.loads(text) if text is not None else {}
    level = body.get("level")
    if not isinstance(level, str):
        return saves.refuse(400, "The body must name a level")
    if level not in LEVELS:
        return saves.refuse(404, "No such level")
    # "not" is the board on screen, so New game always changes it.
    puzzle = secrets.choice([p for p in PACK[level] if p["givens"] != body.get("not")])
    return JSONResponse({"level": level, **puzzle}, headers=saves.NO_STORE)


def install(app: FastAPI) -> None:
    app.include_router(router)
