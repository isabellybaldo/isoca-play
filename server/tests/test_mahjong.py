import json
from collections import Counter
from pathlib import Path

import pytest

from conftest import BASE_URL
from isoca_play import mahjong
from isoca_play.mahjong import (
    FACES,
    LAYOUTS,
    DealError,
    free_ids,
    is_covered,
    is_free,
    make_deal,
    match_key,
)

ORIGIN = {"Origin": BASE_URL}
SERVER = Path(__file__).resolve().parents[1]
SHARED = SERVER.parent / "shared"
SLOT_COUNT = 4


def by_id(layout_id):
    return next(l for l in LAYOUTS if l["id"] == layout_id)


def shared(name):
    return json.loads((SHARED / name).read_text(encoding="utf-8"))


def can_win(tiles):
    """Depth-first search over the slot rule, trying moves that make a pair first."""
    kind = {t["id"]: match_key(t["face"]) for t in tiles}
    seen = set()

    def search(on_board, slots):
        if not on_board and not slots:
            return True
        if (on_board, slots) in seen:
            return False
        seen.add((on_board, slots))
        held = {kind[i] for i in slots}
        free = free_ids(tiles, on_board)
        for tile_id in sorted(free, key=lambda i: kind[i] not in held):
            rest = tuple(i for i in on_board if i != tile_id)
            pair = next((i for i in slots if kind[i] == kind[tile_id]), None)
            after = (
                tuple(i for i in slots if i != pair) if pair is not None else (*slots, tile_id)
            )
            if len(after) < SLOT_COUNT and search(rest, after):
                return True
        return False

    return search(tuple(t["id"] for t in tiles), ())


def spread(tiles):
    """Tiles far enough apart that all are free, so any number of pairs can be dealt."""
    cells = [{"x": i * 4, "y": 0, "z": 0} for i in range(tiles)]
    return {"id": "spread", "name": "Spread", "level": "easy", "cells": cells}


def kind_counts(tiles):
    return Counter(match_key(t["face"]) for t in tiles)


@pytest.fixture
def client_logged_in(client, sign_in):
    sign_in(client)
    return client


def post(client, **kwargs):
    kwargs.setdefault("headers", ORIGIN)
    return client.post("/api/new/mahjong", **kwargs)


# Deals


@pytest.mark.parametrize("layout", LAYOUTS, ids=lambda l: l["id"])
def test_every_deal_is_winnable_with_real_rules(layout):
    for seed in range(1, 201):
        assert can_win(make_deal(layout, seed))


def test_can_win_rejects_a_deal_that_cannot_be_won():
    # One tower of ten tiles: the top comes off first, e d c b fill the four slots.
    faces = ["a", "b", "c", "d", "e", "a", "b", "c", "d", "e"]
    tiles = [{"id": i, "x": 0, "y": 0, "z": i, "face": face} for i, face in enumerate(faces)]
    assert can_win(tiles) is False


def test_same_seed_same_deal():
    for layout in LAYOUTS:
        assert make_deal(layout, 7) == make_deal(layout, 7)
        assert make_deal(layout, 7) != make_deal(layout, 8)


def test_the_deal_keeps_the_layout_cells_and_ids():
    for layout in LAYOUTS:
        tiles = make_deal(layout, 3)
        assert len(tiles) == len(layout["cells"])
        for i, tile in enumerate(tiles):
            assert tile["id"] == i
            assert {k: tile[k] for k in "xyz"} == layout["cells"][i]


def test_there_are_42_faces_and_36_match_kinds():
    assert len(set(FACES)) == 42
    assert len({match_key(f) for f in FACES}) == 36


def test_every_kind_appears_an_even_number_of_times_and_only_known_faces_are_used():
    for layout in LAYOUTS:
        for seed in (1, 2, 3):
            tiles = make_deal(layout, seed)
            assert all(t["face"] in FACES for t in tiles)
            assert all(n % 2 == 0 for n in kind_counts(tiles).values())


def test_fewer_pairs_than_kinds_uses_a_random_subset_each_kind_once():
    layout = spread(20)
    for seed in (1, 2, 3):
        counts = kind_counts(make_deal(layout, seed))
        assert len(counts) == 10
        assert set(counts.values()) == {2}
    assert set(kind_counts(make_deal(layout, 1))) != set(kind_counts(make_deal(layout, 2)))


def test_more_pairs_than_kinds_reuses_them_evenly():
    for seed in (1, 2, 3):
        counts = kind_counts(make_deal(spread(100), seed))  # 50 pairs over 36 kinds
        assert len(counts) == 36
        assert set(counts.values()) <= {2, 4}


def test_a_season_or_flower_pair_uses_two_different_faces():
    seen = 0
    for seed in range(1, 41):
        faces = [t["face"] for t in make_deal(spread(40), seed)]
        for kind in ("season", "flower"):
            group = [f for f in faces if match_key(f) == kind]
            if group:
                seen += 1
                assert len(group) == 2
                assert group[0] != group[1]
    assert seen > 0


def test_a_suit_tile_critter_or_sweet_pair_is_two_of_the_same_face():
    faces = [t["face"] for t in make_deal(spread(72), 9)]
    for face in ("circle1", "bamboo1", "star1", "cat", "heart"):
        assert faces.count(face) == 2


def test_a_layout_that_cannot_be_dealt_raises_instead_of_looping():
    # Two stacked tiles: only the top is ever free, so no attempt can take a pair.
    layout = {
        "id": "tower",
        "name": "Tower",
        "level": "easy",
        "cells": [{"x": 0, "y": 0, "z": 0}, {"x": 0, "y": 0, "z": 1}],
    }
    with pytest.raises(DealError):
        make_deal(layout, 1)


# Layouts and the shared files


def test_the_layouts_are_the_twelve_shapes_at_their_sizes():
    sizes = {l["id"]: (l["level"], len(l["cells"])) for l in LAYOUTS}
    assert sizes == {
        "frame": ("easy", 42), "heart": ("easy", 42), "cat": ("easy", 44), "cherry": ("easy", 44),
        "trophy": ("medium", 62), "butterfly": ("medium", 62), "panda": ("medium", 62), "moon": ("medium", 62),
        "fort": ("hard", 72), "rose": ("hard", 72), "frog": ("hard", 72), "gate": ("hard", 72),
    }
    for level in ("easy", "medium", "hard"):
        assert len([l for l in LAYOUTS if l["level"] == level]) == 4


@pytest.mark.parametrize("layout", LAYOUTS, ids=lambda l: l["id"])
def test_every_map_deals_fifty_times_without_an_error(layout):
    for seed in range(1, 51):
        make_deal(layout, seed)


def test_shared_rule_cases_hold():
    cases = shared("rule-cases.json")
    assert cases
    for case in cases:
        tiles, on_board = case["tiles"], case["onBoard"]
        assert [i for i in on_board if is_covered(tiles, on_board, i)] == case["covered"], case["name"]
        assert [i for i in on_board if is_free(tiles, on_board, i)] == case["free"], case["name"]
        assert free_ids(tiles, on_board) == case["free"], case["name"]
        for face, key in case["matchKeys"].items():
            assert match_key(face) == key, case["name"]


def test_an_unknown_tile_is_neither_covered_nor_free():
    tiles = [{"id": 1, "x": 0, "y": 0, "z": 0, "face": "a"}]
    assert is_covered(tiles, [1], 99) is False
    assert is_free(tiles, [1], 99) is False


def test_the_committed_samples_are_what_make_deal_gives():
    samples = shared("deal-samples.json")
    per_layout = Counter(s["layout"] for s in samples)
    assert per_layout == {l["id"]: 20 for l in LAYOUTS}
    for sample in samples:
        assert sample["tiles"] == make_deal(by_id(sample["layout"]), sample["seed"])


@pytest.mark.parametrize("name", ["layouts.json", "faces.json"])
def test_the_packaged_copy_is_the_shared_file(name):
    # The web app reads shared/; the installed package can only carry files inside it.
    packaged = (Path(mahjong.__file__).parent / "shared" / name).read_text(encoding="utf-8")
    assert json.loads(packaged) == shared(name)


def test_the_package_ships_its_json():
    assert '"shared/*.json"' in (SERVER / "pyproject.toml").read_text(encoding="utf-8")


# The route


def test_a_new_deal_comes_back_with_its_tiles(client_logged_in):
    r = post(client_logged_in, json={"layout": "fort"})
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["layout"] == "fort"
    cells = by_id("fort")["cells"]
    assert [{k: t[k] for k in "xyz"} for t in body["tiles"]] == cells
    assert [t["id"] for t in body["tiles"]] == list(range(len(cells)))
    assert all(set(t) == {"id", "x", "y", "z", "face"} for t in body["tiles"])
    assert can_win(body["tiles"])


def test_new_deals_differ(client_logged_in):
    deals = [post(client_logged_in, json={"layout": "fort"}).json()["tiles"] for _ in range(3)]
    assert deals[0] != deals[1] or deals[1] != deals[2]


def test_unknown_layout_is_404(client_logged_in):
    for name in ("chess", "Fort", ""):
        r = post(client_logged_in, json={"layout": name})
        assert r.status_code == 404
        assert r.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "raw",
    [b"", b"not json", b"[]", b"{}", b'{"layout": 1}', b'{"layout": ["fort"]}', b'{"layout": null}'],
)
def test_a_bad_body_is_400(client_logged_in, raw):
    assert post(client_logged_in, content=raw).status_code == 400


def test_an_oversized_body_is_413(client_logged_in):
    raw = b'{"layout": "' + b"x" * (512 * 1024) + b'"}'
    assert post(client_logged_in, content=raw).status_code == 413


def test_it_needs_a_session(client):
    assert post(client, json={"layout": "fort"}).status_code == 401


def test_a_foreign_origin_is_refused(client_logged_in):
    r = post(client_logged_in, json={"layout": "fort"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
