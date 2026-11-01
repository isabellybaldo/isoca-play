"""Write shared/tip-cases.json: what the grader does at each tip, for web/src/sudoku/tips.ts.

Run from anywhere with plain Python (the pack decides the output):

    python tools/make_tip_cases.py

A tip knows only the written digits, so each one starts over from them. solve() keeps its
eliminations between placements, so its own trace would not match. Each board's tips is a
comma-separated string, one entry per tip: the TECHNIQUES index of each step that fired,
then the placed cell as two digits, then the placed digit. So "2251234" is steps 2, 2, 5
and 1, placing 4 in cell 23: the last three characters are always the cell and digit.
"""

from __future__ import annotations

import json
from pathlib import Path

from sudoku_grader import TECHNIQUES, load

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "server" / "isoca_play" / "data" / "sudoku_pack.json"
TARGET = ROOT / "shared" / "tip-cases.json"


def next_tip(written: str) -> tuple[list[int], int, int]:
    """The technique indices up to the first placement, and the cell and digit it placed."""
    board = load(written)
    fired: list[int] = []
    while True:
        for index, (_tier, _name, step) in enumerate(TECHNIQUES):
            if step(board):
                fired.append(index)
                break
        else:
            raise ValueError(f"stuck at {written}")
        for cell, value in enumerate(board.values):
            if value and written[cell] == ".":
                return fired, cell, value


def board_tips(givens: str) -> tuple[str, str]:
    """One board played out tip by tip: the tips string and the digits it ends on."""
    written = givens
    tips = []
    while "." in written:
        fired, cell, digit = next_tip(written)
        tips.append("".join(map(str, fired)) + f"{cell:02d}{digit}")
        written = written[:cell] + str(digit) + written[cell + 1 :]
    return ",".join(tips), written


def main() -> None:
    pack = json.loads(PACK.read_text(encoding="utf-8"))
    cases = []
    for puzzles in pack.values():
        for puzzle in puzzles:
            tips, finished = board_tips(puzzle["givens"])
            if finished != puzzle["solution"]:
                raise ValueError(f"{puzzle['givens']} ended at {finished}")
            cases.append({"givens": puzzle["givens"], "solution": puzzle["solution"], "tips": tips})
    lines = ",\n".join(json.dumps(case, separators=(",", ":")) for case in cases)
    TARGET.write_text("[\n" + lines + "\n]\n", encoding="utf-8", newline="\n")
    print(f"wrote {len(cases)} boards, every one ending at its solution, {TARGET.stat().st_size} bytes")


if __name__ == "__main__":
    main()
