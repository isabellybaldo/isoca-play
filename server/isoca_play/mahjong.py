"""Mahjong deals: POST /api/new/mahjong gives a new deal for a layout.

Only a signed-in session reaches the route, and it must also pass the Origin
check: both are the guard's (auth.require_session), not repeated here.

The layouts and faces are read from shared/ inside this package, a copy of the
repo's shared/ that the web app reads (a test holds the two equal). The rules here
are the part of web/src/mahjong/rules.ts a deal needs; shared/rule-cases.json holds
the two to the same answers.
"""

from __future__ import annotations

import json
import secrets
from pathlib import Path
from typing import Callable, Collection, Iterable, Sequence, TypedDict, TypeVar

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from . import saves

T = TypeVar("T")


class Cell(TypedDict):
    x: int
    y: int
    z: int


class Tile(TypedDict):
    """x and y are in half-tile units: a tile is 2 wide and 2 tall."""

    id: int
    x: int
    y: int
    z: int
    face: str


class Layout(TypedDict):
    id: str
    name: str
    level: str
    cells: list[Cell]


class DealError(Exception):
    """No deal found within MAX_ATTEMPTS: the layout can't be taken apart in pairs."""


# A real layout needs a handful of attempts at most; this only stops a bad one
# hanging a worker forever.
MAX_ATTEMPTS = 1000
_SHARED = Path(__file__).parent / "shared"


def _read(name: str):
    return json.loads((_SHARED / name).read_text(encoding="utf-8"))


def _cells(layers: list[list[str]]) -> list[Cell]:
    # Each layer is a list of rows; '#' is a tile, anything else is empty. Odd layers
    # sit half a tile right of and below the even ones. Same as fromLayers in layouts.ts.
    cells: list[Cell] = []
    for z, rows in enumerate(layers):
        half = z % 2
        for r, row in enumerate(rows):
            for c, ch in enumerate(row):
                if ch == "#":
                    cells.append({"x": c * 2 + half, "y": r * 2 + half, "z": z})
    return cells


_faces = _read("faces.json")
FACES: list[str] = _faces["faces"]
_GROUP_OF = {face: group for group, faces in _faces["groups"].items() for face in faces}
LAYOUTS: list[Layout] = [
    {"id": l["id"], "name": l["name"], "level": l["level"], "cells": _cells(l["layers"])}
    for l in _read("layouts.json")
]
_LAYOUT_BY_ID = {l["id"]: l for l in LAYOUTS}


# Rules


def match_key(face: str) -> str:
    """Two tiles pair when their keys are equal: any season matches any season, any
    flower matches any flower, and everything else matches only itself."""
    return _GROUP_OF.get(face, face)


KINDS = list(dict.fromkeys(match_key(face) for face in FACES))


def _tile_covered(tile: Tile, others: Iterable[Tile]) -> bool:
    return any(
        o["z"] == tile["z"] + 1 and abs(o["x"] - tile["x"]) < 2 and abs(o["y"] - tile["y"]) < 2
        for o in others
    )


def _tile_free(tile: Tile, others: Sequence[Tile]) -> bool:
    if _tile_covered(tile, others):
        return False
    side = [o for o in others if o["z"] == tile["z"] and abs(o["y"] - tile["y"]) < 2]
    left_blocked = any(o["x"] - tile["x"] == -2 for o in side)
    right_blocked = any(o["x"] - tile["x"] == 2 for o in side)
    return not left_blocked or not right_blocked


def _split(
    tiles: Sequence[Tile], on_board: Collection[int], tile_id: int
) -> tuple[Tile | None, list[Tile]]:
    """The tile with this id, and the other tiles still on the board."""
    tile = next((t for t in tiles if t["id"] == tile_id), None)
    return tile, [t for t in tiles if t["id"] in on_board and t["id"] != tile_id]


def is_covered(tiles: Sequence[Tile], on_board: Collection[int], tile_id: int) -> bool:
    """A board tile one layer up overlaps this one by less than a full tile in both axes."""
    tile, others = _split(tiles, on_board, tile_id)
    return tile is not None and _tile_covered(tile, others)


def is_free(tiles: Sequence[Tile], on_board: Collection[int], tile_id: int) -> bool:
    """Not covered, and the left or the right side has no neighbour on the same layer."""
    tile, others = _split(tiles, on_board, tile_id)
    return tile is not None and _tile_free(tile, others)


def free_ids(tiles: Sequence[Tile], on_board: Sequence[int]) -> list[int]:
    """The free tiles on the board, in on_board order."""
    by_id = {t["id"]: t for t in tiles}
    board = [by_id[i] for i in on_board]
    return [t["id"] for t in board if _tile_free(t, [o for o in board if o is not t])]


# Deals


def _mulberry32(seed: int) -> Callable[[], float]:
    a = seed & 0xFFFFFFFF

    def rand() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61))) & 0xFFFFFFFF
        return (t ^ (t >> 14)) / 4294967296

    return rand


def _shuffle(items: Sequence[T], rand: Callable[[], float]) -> list[T]:
    out = list(items)
    for i in range(len(out) - 1, 0, -1):
        j = int(rand() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


def _kind_sequence(pairs: int, rand: Callable[[], float]) -> list[str]:
    """One match kind per pair. Each block is a fresh shuffle of every kind, so fewer
    pairs than kinds get a random subset, and a kind only repeats after all the others
    have been used, never twice in a row."""
    out: list[str] = []
    while len(out) < pairs:
        block = _shuffle(KINDS, rand)
        if out and block[0] == out[-1]:
            block = [*block[1:], block[0]]
        out.extend(block)
    return out[:pairs]


def _pair_faces(kind: str, rand: Callable[[], float]) -> tuple[str, str]:
    """Two different faces from a season or flower group, else one face twice."""
    group = [face for face in FACES if match_key(face) == kind]
    if len(group) == 1:
        return group[0], group[0]
    first, second, *_ = _shuffle(group, rand)
    return first, second


def _attempt(layout: Layout, rand: Callable[[], float]) -> tuple[list[Tile], list[list[int]]] | None:
    """Take away two free tiles at a time and give each pair the next kind. Played in
    that order, returned with the tiles, the deal is a win that never holds more than
    one tile in the slots."""
    tiles: list[Tile] = [{"id": i, **cell, "face": ""} for i, cell in enumerate(layout["cells"])]
    remaining = [t["id"] for t in tiles]
    order: list[list[int]] = []
    for kind in _kind_sequence(len(tiles) // 2, rand):
        free = set(free_ids(tiles, remaining))
        found: list[int] = []
        for tile_id in _shuffle(remaining, rand):
            if tile_id in free:
                found.append(tile_id)
                if len(found) == 2:
                    break
        if len(found) < 2:
            return None
        for tile_id, face in zip(found, _pair_faces(kind, rand)):
            tiles[tile_id]["face"] = face
        remaining = [i for i in remaining if i not in found]
        order.append(found)
    return tiles, order


def make_deal_with_order(layout: Layout, seed: int) -> tuple[list[Tile], list[list[int]]]:
    """The deal, and the pairs in the order that clears it."""
    rand = _mulberry32(seed)
    for _ in range(MAX_ATTEMPTS):
        dealt = _attempt(layout, rand)
        if dealt is not None:
            return dealt
    raise DealError(f"no deal for layout {layout['id']!r} after {MAX_ATTEMPTS} attempts")


def make_deal(layout: Layout, seed: int) -> list[Tile]:
    return make_deal_with_order(layout, seed)[0]


# The route

router = APIRouter()


@router.post("/api/new/mahjong")
async def new_mahjong(request: Request) -> Response:
    raw = await saves.read_body(request)
    if raw is None:
        return saves.refuse(413, "Too large")
    text = saves.parse_object(raw)
    name = json.loads(text).get("layout") if text is not None else None
    if not isinstance(name, str):
        return saves.refuse(400, "The body must name a layout")
    layout = _LAYOUT_BY_ID.get(name)
    if layout is None:
        return saves.refuse(404, "No such layout")
    tiles = await run_in_threadpool(make_deal, layout, secrets.randbelow(2**32))
    return JSONResponse({"layout": name, "tiles": tiles}, headers=saves.NO_STORE)


def install(app: FastAPI) -> None:
    app.include_router(router)
