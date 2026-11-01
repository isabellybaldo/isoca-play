import json
import sys
from pathlib import Path

import pytest

from conftest import BASE_URL
from isoca_play.solitaire import PACK

TOOLS = Path(__file__).resolve().parents[2] / "tools"
sys.path.insert(0, str(TOOLS))

import make_solitaire_cases  # noqa: E402  (plain Python, from the repo's tools/)
from solitaire_rules import apply_move, new_game  # noqa: E402  (plain Python, from the repo's tools/)

ORIGIN = {"Origin": BASE_URL}
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


# The pack


def test_every_pack_deal_is_a_permutation():
    assert all(sorted(p["deal"]) == list(range(52)) for p in PACK)


def test_pack_has_500_different_deals():
    assert len(PACK) == 500
    assert len({tuple(p["deal"]) for p in PACK}) == 500
    assert all(set(p) == {"deal", "moves"} for p in PACK)


def test_every_pack_deal_is_won_by_its_moves():
    """The proof: the project's own rules, move by move, reach a win."""
    for p in PACK:
        state = new_game(p["deal"])
        for move in p["moves"]:
            state = apply_move(state, move)
            assert state is not None, (p["deal"], move)
        assert state["status"] == "won", p["deal"]


# The route


def post(client, **kwargs):
    kwargs.setdefault("headers", ORIGIN)
    return client.post("/api/new/solitaire", **kwargs)


@pytest.fixture
def client_logged_in(client, sign_in):
    sign_in(client)
    return client


def test_new_answers_a_pack_deal_without_its_moves(client_logged_in):
    response = post(client_logged_in, json={})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"deal"}
    assert body["deal"] in [p["deal"] for p in PACK]
    assert response.headers["cache-control"] == "no-store"


def test_not_changes_the_deal(client_logged_in):
    on_screen = PACK[0]["deal"]
    for _ in range(50):
        assert post(client_logged_in, json={"not": on_screen}).json()["deal"] != on_screen


def test_not_is_optional_and_any_other_value_excludes_nothing(client_logged_in):
    for extra in ({}, {"not": None}, {"not": 7}, {"not": ["x"]}):
        assert post(client_logged_in, json=extra).status_code == 200


def test_a_body_that_is_not_an_object_counts_as_empty(client_logged_in):
    for body in (b"", b"nope", b"[]"):
        assert post(client_logged_in, content=body).status_code == 200


def test_new_needs_a_session(client):
    assert post(client, json={}).status_code == 401


def test_new_needs_the_origin(client_logged_in):
    assert post(client_logged_in, json={}, headers={}).status_code == 403


def test_too_large_is_refused(client_logged_in):
    assert post(client_logged_in, content=b"x" * (512 * 1024 + 1)).status_code == 413
