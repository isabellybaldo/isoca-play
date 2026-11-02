"""Klondike solitaire rules in Python, the twin of web/src/solitaire/rules.ts.

Plain Python, for tools and tests only. A card is 0-51: suit * 13 + rank - 1, suits 0 heart,
1 diamond, 2 club, 3 spade, rank 1 the ace. A move is 'd' (turn a card), 'r' (turn the pile
back over), or 'c3>c5:2' (move 2 cards). Piles are 'w', 'f0'-'f3' and 'c0'-'c6'.
"""

from __future__ import annotations

import copy
import random
import re

MOVE = re.compile(r"^([wfc][0-6]?)>([fc][0-6]):([1-9][0-9]*)$")
PILE = re.compile(r"^(?:w|f[0-3]|c[0-6])$")


def suit_of(card: int) -> int:
    return card // 13


def rank_of(card: int) -> int:
    return card % 13 + 1


def is_red(card: int) -> bool:
    return suit_of(card) < 2


def new_game(deal: list[int]) -> dict:
    columns = []
    at = 0
    for i in range(7):
        cards = deal[at : at + i + 1]
        at += i + 1
        columns.append({"down": cards[:-1], "up": cards[-1:]})
    return {
        "deal": list(deal),
        "stock": list(deal[28:]),
        "waste": [],
        "columns": columns,
        "foundations": [0, 0, 0, 0],
        "history": [],
        "status": "playing",
    }


def _lifted(state: dict, source: str, n: int) -> list[int] | None:
    """The cards that would leave source, bottom first, or None if it cannot give n."""
    if source == "w":
        return [state["waste"][-1]] if n == 1 and state["waste"] else None
    index = int(source[1])
    if source[0] == "f":
        count = state["foundations"][index]
        return [index * 13 + count - 1] if n == 1 and count > 0 else None
    up = state["columns"][index]["up"]
    return up[len(up) - n :] if 1 <= n <= len(up) else None


def _can_move(state: dict, source: str, target: str, n: int) -> bool:
    if state["status"] != "playing" or source == target or target == "w":
        return False
    cards = _lifted(state, source, n)
    if not cards:
        return False
    lead = cards[0]
    index = int(target[1])
    if target[0] == "f":
        return (
            n == 1
            and source[0] != "f"
            and suit_of(lead) == index
            and rank_of(lead) == state["foundations"][index] + 1
        )
    column = state["columns"][index]
    if not column["up"]:
        return not column["down"] and rank_of(lead) == 13
    top = column["up"][-1]
    return rank_of(top) == rank_of(lead) + 1 and is_red(top) != is_red(lead)


def apply_move(state: dict, move: str) -> dict | None:
    """The state after the move, or None if it is invalid. The state given is not changed."""
    if state["status"] != "playing":
        return None
    if move in ("d", "r"):
        if (move == "d") != bool(state["stock"]) or (move == "r" and not state["waste"]):
            return None
        after = copy.deepcopy(state)
        if move == "d":
            after["waste"].append(after["stock"].pop(0))
        else:
            after["stock"], after["waste"] = after["waste"], []
        after["history"].append(move)
        return after
    parts = MOVE.match(move)
    if not parts or not PILE.match(parts[1]) or not PILE.match(parts[2]):
        return None
    source, target, n = parts[1], parts[2], int(parts[3])
    if not _can_move(state, source, target, n):
        return None
    after = copy.deepcopy(state)
    cards = _lifted(state, source, n)
    turned = False
    if source == "w":
        after["waste"].pop()
    elif source[0] == "f":
        after["foundations"][int(source[1])] -= 1
    else:
        column = after["columns"][int(source[1])]
        del column["up"][len(column["up"]) - n :]
        if not column["up"] and column["down"]:
            column["up"].append(column["down"].pop())
            turned = True
    if target[0] == "f":
        after["foundations"][int(target[1])] += 1
    else:
        after["columns"][int(target[1])]["up"].extend(cards)
    after["history"].append(f"{source}>{target}:{n}" + ("!" if turned else ""))
    if all(count == 13 for count in after["foundations"]):
        after["status"] = "won"
    return after


PILES = ["w"] + [f"f{i}" for i in range(4)] + [f"c{i}" for i in range(7)]


def random_move(state: dict, rng: random.Random) -> str:
    """Any well-formed move at all, valid or not, for walks that test the refusals too."""
    if rng.random() < 0.15:
        return rng.choice(["d", "r"])
    source = rng.choice(PILES)
    target = rng.choice(PILES[1:])
    limit = len(state["columns"][int(source[1])]["up"]) if source[0] == "c" else 1
    return f"{source}>{target}:{rng.randint(1, max(limit, 1) + 1)}"


def legal_moves(state: dict) -> list[str]:
    """Every valid move there is."""
    found = [m for m in ("d", "r") if apply_move(state, m)]
    for source in PILES:
        limit = len(state["columns"][int(source[1])]["up"]) if source[0] == "c" else 1
        for target in PILES[1:]:
            for n in range(1, limit + 1):
                if _can_move(state, source, target, n):
                    found.append(f"{source}>{target}:{n}")
    return found
