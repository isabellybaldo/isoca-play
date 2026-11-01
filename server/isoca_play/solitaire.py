"""New solitaire games: POST /api/new/solitaire gives a deal from the pack.

Only a signed-in session reaches the route, and it must also pass the Origin check:
both are the guard's (auth.require_session), not repeated here.

data/solitaire_pack.json is written ahead of time by tools/make_solitaire_pack.py. Each
entry holds a deal and the moves that win it, proven there by replaying them through the
rules. The moves stay on the server, so a save holds no solution, and no solver is here.
"""

from __future__ import annotations

import json
import secrets
from pathlib import Path

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse, Response

from . import saves

PACK: list[dict] = json.loads(
    (Path(__file__).parent / "data" / "solitaire_pack.json").read_text(encoding="utf-8")
)

router = APIRouter()


@router.post("/api/new/solitaire")
async def new_solitaire(request: Request) -> Response:
    raw = await saves.read_body(request)
    if raw is None:
        return saves.refuse(413, "Too large")
    text = saves.parse_object(raw)
    body = json.loads(text) if text is not None else {}
    # "not" is the deal on screen, so New game always changes it.
    deal = secrets.choice([p for p in PACK if p["deal"] != body.get("not")])["deal"]
    return JSONResponse({"deal": deal}, headers=saves.NO_STORE)


def install(app: FastAPI) -> None:
    app.include_router(router)
