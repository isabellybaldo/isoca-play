"""Write server/isoca_play/data/sudoku_pack.json: graded puzzles, generated here.

Run from anywhere with plain Python (same seed, same pack):

    python tools/make_sudoku_pack.py
    python tools/make_sudoku_pack.py --stats         # the techniques the pack needs
    python tools/make_sudoku_pack.py --cross-check   # ask rustoku too (requirements.txt)

Each puzzle starts from a random full grid. Numbers come off one at a time, in random
order, and stay off only while the level's rules still finish the board, which also
proves one solution. A board stops once it is sparse enough and truly needs its
level's rules. One that never gets there is discarded.
"""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path

from sudoku_grader import UNITS, grade, solve

TARGET = Path(__file__).resolve().parents[1] / "server" / "isoca_play" / "data" / "sudoku_pack.json"
SEED = 20261101
PER_LEVEL = 300
TIER = {"easy": 1, "medium": 2, "hard": 3}
# The given numbers a board of each level may keep, so harder boards give fewer. A board
# aims for a number picked in this range and is discarded if it ends up outside it.
GIVENS = {"easy": (34, 38), "medium": (28, 31), "hard": (22, 27)}


def full_grid(rng: random.Random) -> list[int]:
    grid = [0] * 81
    units_of = [[u for u in UNITS if i in u] for i in range(81)]

    def fill(i: int) -> bool:
        if i == 81:
            return True
        taken = {grid[j] for unit in units_of[i] for j in unit}
        digits = [d for d in range(1, 10) if d not in taken]
        rng.shuffle(digits)
        for digit in digits:
            grid[i] = digit
            if fill(i + 1):
                return True
        grid[i] = 0
        return False

    fill(0)
    return grid


def make_one(level: str, rng: random.Random) -> dict | None:
    tier = TIER[level]
    solution = "".join(map(str, full_grid(rng)))
    givens = list(solution)
    low, high = GIVENS[level]
    target = rng.randint(low, high)
    order = list(range(81))
    rng.shuffle(order)
    count = 81
    for i in order:
        givens[i] = "."
        if solve("".join(givens), max_tier=tier).complete:
            count -= 1
            if count <= target and grade("".join(givens)) == level:
                break
        else:
            givens[i] = solution[i]
    text = "".join(givens)
    if grade(text) != level or not low <= count <= high or solve(text).board != solution:
        return None
    return {"givens": text, "solution": solution}


def make_level(level: str, seed: int, per_level: int) -> list[dict]:
    rng = random.Random(f"{seed}-{level}")
    puzzles: list[dict] = []
    seen: set[str] = set()
    tried = 0
    while len(puzzles) < per_level:
        tried += 1
        puzzle = make_one(level, rng)
        if puzzle and puzzle["givens"] not in seen:
            seen.add(puzzle["givens"])
            puzzles.append(puzzle)
            if len(puzzles) % 50 == 0:
                print(f"{level}: {len(puzzles)} kept of {tried} tried", flush=True)
    print(f"{level}: {len(puzzles)} kept of {tried} tried", flush=True)
    return puzzles


def write(pack: dict[str, list[dict]]) -> None:
    levels = []
    for level, puzzles in pack.items():
        lines = ",\n".join("    " + json.dumps(p, separators=(",", ":")) for p in puzzles)
        levels.append(f'  "{level}": [\n{lines}\n  ]')
    TARGET.parent.mkdir(exist_ok=True)
    TARGET.write_text("{\n" + ",\n".join(levels) + "\n}\n", encoding="utf-8", newline="\n")


def read() -> dict[str, list[dict]]:
    return json.loads(TARGET.read_text(encoding="utf-8"))


def stats(pack: dict[str, list[dict]]) -> None:
    for level, puzzles in pack.items():
        counts = [81 - p["givens"].count(".") for p in puzzles]
        boards_with: Counter = Counter()
        wrong = 0
        for p in puzzles:
            result = solve(p["givens"])
            boards_with.update(result.used.keys())
            wrong += grade(p["givens"]) != level or result.board != p["solution"]
        print(
            f"{level}: {len(puzzles)} boards, givens {min(counts)}-{max(counts)}, "
            f"mean {sum(counts) / len(counts):.1f}, wrong grade {wrong}"
        )
        for name, boards in boards_with.most_common():
            print(f"    {name}: {boards} boards")


def cross_check(pack: dict[str, list[dict]]) -> None:
    """A second opinion from rustoku's solve path: it reports technique 'None' for a
    step that its allowed techniques could not make. Its level names are its own: its
    'medium' also allows triples, and its 'hard' Skyscraper, so what counts is which
    techniques its path used, never its level's name."""
    import rustoku  # MIT, huangsam/rustoku; a development check, never in the server

    singles = {"Naked Singles", "Hidden Singles"}
    up_to_pairs = singles | {"Locked Candidates", "Naked Pairs", "Hidden Pairs"}

    def techniques(givens: str, level: str) -> set[str]:
        return {s["technique"] for s in rustoku.solve_steps(givens, level)["steps"]}

    for level, puzzles in pack.items():
        disagree = 0
        for p in puzzles:
            easy = techniques(p["givens"], "easy")
            medium = techniques(p["givens"], "medium")
            if level == "easy":
                fine = easy <= singles
            elif level == "medium":
                fine = "None" in easy and medium <= up_to_pairs
            else:
                fine = not medium <= up_to_pairs
            if not fine:
                disagree += 1
                print(f"  {level} disagrees: {p['givens']}")
        print(f"{level}: rustoku agrees on {len(puzzles) - disagree} of {len(puzzles)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--per-level", type=int, default=PER_LEVEL)
    parser.add_argument("--stats", action="store_true")
    parser.add_argument("--cross-check", action="store_true")
    args = parser.parse_args()
    if args.stats:
        stats(read())
    elif args.cross_check:
        cross_check(read())
    else:
        pack = {level: make_level(level, args.seed, args.per_level) for level in TIER}
        write(pack)
        stats(pack)


if __name__ == "__main__":
    main()
