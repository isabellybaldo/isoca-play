"""Write server/isoca_play/data/solitaire_pack.json: winnable deals, found here.

Run from anywhere with plain Python (same seed, same pack):

    python tools/make_solitaire_pack.py
    python tools/make_solitaire_pack.py --stats    # how many were tried, discarded, and move counts

Each deal is a random shuffle. A small depth-first search of our own looks for a win under
the project's rules (draw one, unlimited passes) and gives up on a deal after NODE_LIMIT
positions: that deal is discarded, never assumed. No solver is trusted: a deal is kept only
if its moves, replayed through solitaire_rules.apply_move, reach 'won'.

(The published solvers were tried first and did not work here: see the commit message.)

The search treats stock and waste as one ring of cards, so a card anywhere in it can be
played at the cost of the turns that bring it to the top. A move of the search is a whole
play, written out as the 'd' and 'r' turns and then the move itself.
"""

from __future__ import annotations

import argparse
import json
import multiprocessing
import random
from pathlib import Path

from solitaire_rules import apply_move, new_game

TARGET = Path(__file__).resolve().parents[1] / "server" / "isoca_play" / "data" / "solitaire_pack.json"
SEED = 20261101
PER_PACK = 500
NODE_LIMIT = 40_000

OPPOSITE = {0: (2, 3), 1: (2, 3), 2: (0, 1), 3: (0, 1)}


def suit(card: int) -> int:
    return card // 13


def rank(card: int) -> int:
    return card % 13 + 1


def red(card: int) -> bool:
    return card < 26


def safe(card: int, found: tuple) -> bool:
    """Moving this card up can never hurt: nothing of the other colour still needs it."""
    low, high = (found[o] for o in OPPOSITE[suit(card)])
    return rank(card) <= min(low, high) + 2


def settle(cols: tuple, found: tuple) -> tuple[tuple, tuple, list[str]]:
    """Play every safe column top to its foundation, turning cards as they come free."""
    moves: list[str] = []
    cols = list(cols)
    found = list(found)
    again = True
    while again:
        again = False
        for i, (down, up) in enumerate(cols):
            if up:
                card = up[-1]
                if found[suit(card)] == rank(card) - 1 and safe(card, found):
                    found[suit(card)] += 1
                    moves.append(f"c{i}>f{suit(card)}:1")
                    up = up[:-1]
                    if not up and down:
                        down, up = down[:-1], down[-1:]
                    cols[i] = (down, up)
                    again = True
    return tuple(cols), tuple(found), moves


def turns(index: int, pointer: int, size: int) -> list[str]:
    """The turns that bring ring[index] to the top of the waste, from `pointer` cards turned."""
    if index + 1 >= pointer:
        return ["d"] * (index + 1 - pointer)
    return ["d"] * (size - pointer) + ["r"] + ["d"] * (index + 1)


def take(cols: tuple, i: int, n: int) -> tuple:
    """Columns after n cards leave column i, turning a card if that uncovers one."""
    down, up = cols[i]
    up = up[: len(up) - n]
    if not up and down:
        down, up = down[:-1], down[-1:]
    return cols[:i] + ((down, up),) + cols[i + 1 :]


def children(cols: tuple, found: tuple, ring: tuple, pointer: int):
    """(rank of the move, moves, new columns, new foundations, new ring, new pointer)."""
    out = []
    empty = next((j for j, (d, u) in enumerate(cols) if not u and not d), None)
    # Cards of the stock and waste.
    for index, card in enumerate(ring):
        cost = turns(index, pointer, len(ring))
        new_ring = ring[:index] + ring[index + 1 :]
        if found[suit(card)] == rank(card) - 1:
            f = found[: suit(card)] + (found[suit(card)] + 1,) + found[suit(card) + 1 :]
            out.append((2 + len(cost) / 60, cost + [f"w>f{suit(card)}:1"], cols, f, new_ring, index))
        for j, (down, up) in enumerate(cols):
            if up and rank(up[-1]) == rank(card) + 1 and red(up[-1]) != red(card):
                c = cols[:j] + ((down, up + (card,)),) + cols[j + 1 :]
                out.append((3 + len(cost) / 60, cost + [f"w>c{j}:1"], c, found, new_ring, index))
        if rank(card) == 13 and empty is not None:
            c = cols[:empty] + (((), (card,)),) + cols[empty + 1 :]
            out.append((3 + len(cost) / 60, cost + [f"w>c{empty}:1"], c, found, new_ring, index))
    # Cards of the columns.
    for i, (down, up) in enumerate(cols):
        for n in range(1, len(up) + 1):
            lead = up[len(up) - n]
            whole = n == len(up)
            if not whole and found[suit(up[len(up) - n - 1])] != rank(up[len(up) - n - 1]) - 1:
                continue
            flips = whole and bool(down)
            if n == 1 and found[suit(lead)] == rank(lead) - 1:
                f = found[: suit(lead)] + (found[suit(lead)] + 1,) + found[suit(lead) + 1 :]
                out.append((0 if flips else 1, [f"c{i}>f{suit(lead)}:1"], take(cols, i, 1), f, ring, pointer))
            for j, (d2, u2) in enumerate(cols):
                if j == i:
                    continue
                if u2:
                    ok = rank(u2[-1]) == rank(lead) + 1 and red(u2[-1]) != red(lead)
                else:
                    ok = not d2 and rank(lead) == 13 and (down or not whole)
                if ok:
                    c = take(cols, i, n)
                    c = c[:j] + ((d2, u2 + up[len(up) - n :]),) + c[j + 1 :]
                    out.append((1.5 if flips else 4, [f"c{i}>c{j}:{n}"], c, found, ring, pointer))
    out.sort(key=lambda child: child[0])
    return out


def solve(deal: list[int], limit: int = NODE_LIMIT) -> list[str] | None:
    """A winning list of moves, or None if the search gave up or found none."""
    cols = []
    at = 0
    for i in range(7):
        cards = tuple(deal[at : at + i + 1])
        at += i + 1
        cols.append((cards[:-1], cards[-1:]))
    start = settle(tuple(cols), (0, 0, 0, 0))
    ring = tuple(deal[28:])
    seen = {(start[0], start[1], ring)}
    path = list(start[2])
    stack = [(children(start[0], start[1], ring, 0), 0, len(path))]
    nodes = 0
    if sum(start[1]) == 52:
        return path
    while stack:
        options, at, mark = stack[-1]
        if at >= len(options):
            stack.pop()
            continue
        stack[-1] = (options, at + 1, mark)
        del path[mark:]
        _, moves, c, f, r, p = options[at]
        c, f, extra = settle(c, f)
        key = (c, f, r)
        if key in seen:
            continue
        seen.add(key)
        nodes += 1
        if nodes > limit:
            return None
        path.extend(moves)
        path.extend(extra)
        if sum(f) == 52:
            return path
        stack.append((children(c, f, r, p), 0, len(path)))
    return None


def proves(deal: list[int], moves: list[str]) -> bool:
    """The only test that counts: the project's rules, move by move, reach a win."""
    state = new_game(deal)
    for move in moves:
        state = apply_move(state, move)
        if state is None:
            return False
    return state["status"] == "won"


def attempt(job: tuple[int, int]) -> tuple[list[int], list[str] | None]:
    """Deal number `index` of this seed, and a proven win for it if the search found one."""
    seed, index = job
    deal = list(range(52))
    random.Random(f"{seed}-{index}").shuffle(deal)
    moves = solve(deal)
    return deal, moves if moves and proves(deal, moves) else None


def make(seed: int, count: int) -> tuple[list[dict], int]:
    """The first `count` deals, in order of their number, that the search wins. The
    deals are numbered, so the pack is the same however many processes search."""
    pack: list[dict] = []
    seen: set[tuple] = set()
    tried = 0
    with multiprocessing.Pool() as pool:
        for deal, moves in pool.imap(attempt, ((seed, i) for i in range(count * 4)), chunksize=4):
            tried += 1
            if moves and tuple(deal) not in seen:
                seen.add(tuple(deal))
                pack.append({"deal": deal, "moves": moves})
                if len(pack) % 50 == 0:
                    print(f"{len(pack)} kept of {tried} tried", flush=True)
                if len(pack) == count:
                    pool.terminate()
                    break
    return pack, tried


def write(pack: list[dict]) -> None:
    lines = ",\n".join("  " + json.dumps(p, separators=(",", ":")) for p in pack)
    TARGET.parent.mkdir(exist_ok=True)
    TARGET.write_text("[\n" + lines + "\n]\n", encoding="utf-8", newline="\n")


def stats(pack: list[dict], tried: int | None) -> None:
    lengths = sorted(len(p["moves"]) for p in pack)
    if tried is not None:
        print(f"tried {tried}, kept {len(pack)}, discarded {tried - len(pack)}")
    print(
        f"moves per deal: min {lengths[0]}, median {lengths[len(lengths) // 2]}, "
        f"mean {sum(lengths) / len(lengths):.1f}, max {lengths[-1]}"
    )
    wrong = sum(not proves(p["deal"], p["moves"]) for p in pack)
    print(f"{len(pack)} deals, {wrong} not won by their moves, {TARGET.stat().st_size} bytes")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--count", type=int, default=PER_PACK)
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()
    if args.stats:
        stats(json.loads(TARGET.read_text(encoding="utf-8")), None)
    else:
        pack, tried = make(args.seed, args.count)
        write(pack)
        stats(pack, tried)


if __name__ == "__main__":
    main()
