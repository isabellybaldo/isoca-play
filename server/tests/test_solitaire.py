import json
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2] / "tools"
sys.path.insert(0, str(TOOLS))

import make_solitaire_cases  # noqa: E402  (plain Python, from the repo's tools/)
from solitaire_rules import apply_move, new_game  # noqa: E402  (plain Python, from the repo's tools/)

CASES = TOOLS.parent / "shared" / "solitaire-cases.json"


def test_shared_walks_replay():
    walks = json.loads(CASES.read_text(encoding="utf-8"))
    assert len(walks) == 20
    for walk in walks:
        state = new_game(walk["deal"])
        for step in walk["steps"]:
            after = apply_move(state, step["move"])
            assert (after is not None) == step["valid"], step
            if after is not None:
                state = after
        for field in ("stock", "waste", "columns", "foundations", "status"):
            assert state[field] == walk[field], field


def test_shared_walks_are_up_to_date():
    assert CASES.read_bytes() == make_solitaire_cases.build().encode("utf-8")


def test_the_walks_cover_the_rules():
    walks = json.loads(CASES.read_text(encoding="utf-8"))
    steps = [step for walk in walks for step in walk["steps"]]
    assert 0.2 < sum(not s["valid"] for s in steps) / len(steps) < 0.6
    assert any(s["move"].split(">")[-1].startswith("f") and s["valid"] for s in steps)
    assert any(s["move"] == "r" and s["valid"] for s in steps)
    assert any(w["foundations"] != [0, 0, 0, 0] for w in walks)
