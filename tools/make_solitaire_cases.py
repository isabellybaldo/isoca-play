"""Write shared/solitaire-cases.json: seeded walks of moves, for web/src/solitaire/rules.ts.

Run from anywhere with plain Python (the seeds decide the output):

    python tools/make_solitaire_cases.py

Each walk is a shuffled deal and 200 steps. About a third of the steps are random moves that
may well be invalid; the rest are chosen among the valid ones. A step records the move and
whether it was valid. A walk ends with the piles, columns and answer piles it reached, so
both languages can replay it and compare.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from solitaire_rules import apply_move, legal_moves, new_game, random_move

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "shared" / "solitaire-cases.json"
WALKS = 20
STEPS = 200


def walk(seed: int) -> dict:
    rng = random.Random(seed)
    deal = list(range(52))
    rng.shuffle(deal)
    state = new_game(deal)
    steps = []
    for _ in range(STEPS):
        if rng.random() < 1 / 3:
            move = random_move(state, rng)
        else:
            moves = legal_moves(state)
            # Turning cards forever goes nowhere: mostly take a real move when there is one.
            real = [m for m in moves if m not in ("d", "r")]
            move = rng.choice(real if real and rng.random() < 0.8 else moves)
        after = apply_move(state, move)
        steps.append({"move": move, "valid": after is not None})
        if after is not None:
            state = after
    return {
        "deal": deal,
        "steps": steps,
        "stock": state["stock"],
        "waste": state["waste"],
        "columns": state["columns"],
        "foundations": state["foundations"],
        "status": state["status"],
    }


def build() -> str:
    lines = ",\n".join(json.dumps(walk(seed), separators=(",", ":")) for seed in range(WALKS))
    return "[\n" + lines + "\n]\n"


def main() -> None:
    TARGET.write_text(build(), encoding="utf-8", newline="\n")
    print(f"wrote {WALKS} walks of {STEPS} steps, {TARGET.stat().st_size} bytes")


if __name__ == "__main__":
    main()
