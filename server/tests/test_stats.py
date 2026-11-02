import pytest

from conftest import BASE_URL
from isoca_play import db

ORIGIN = {"Origin": BASE_URL}


@pytest.fixture
def client_logged_in(client, sign_in):
    sign_in(client)
    return client


def record(n=1, **change):
    return {
        "id": f"game-{n}",
        "game": "sudoku",
        "level": "easy",
        "result": "won",
        "day": "2026-11-02",
        "days": ["2026-11-02"],
        "seconds": 100,
        "returns": 0,
        "tips": 0,
        "map": None,
        "slots": None,
        "moves": None,
        "unsolved": 0,
        "turns": None,
        **change,
    }


def mahjong(n=1, map_id="frame", **change):
    return record(n, game="mahjong", map=map_id, slots=True, moves=36, unsolved=None, **change)


def post(client, body, headers=ORIGIN):
    return client.post("/api/stats/game", json=body, headers=headers)


def rows(settings):
    conn = db.connect(settings.db_path)
    try:
        return conn.execute("SELECT COUNT(*) FROM game_record").fetchone()[0]
    finally:
        conn.close()


# Sending records


def test_a_record_is_stored_once_however_often_sent(client_logged_in, settings):
    assert post(client_logged_in, record()).status_code == 204
    assert post(client_logged_in, record()).status_code == 204
    assert rows(settings) == 1


def test_a_day_is_stored_as_the_device_gave_it(client_logged_in, settings):
    assert post(client_logged_in, record(day="1999-01-01")).status_code == 204
    conn = db.connect(settings.db_path)
    try:
        assert conn.execute("SELECT day FROM game_record").fetchone()[0] == "1999-01-01"
    finally:
        conn.close()


@pytest.mark.parametrize(
    "change",
    [
        {"game": "chess"},
        {"result": "drawn"},
        {"day": "01/02/2026"},
        {"day": "2026-02-31"},
        {"seconds": -1},
        {"seconds": 2_592_001},
        {"returns": 1.5},
        {"tips": True},
        {"map": "frame"},
        {"level": "extreme"},
        {"level": None},
        {"id": ""},
        {"id": "x" * 65},
        {"id": 7},
        {"days": ["nope"]},
        {"days": "2026-01-01"},
        {"days": ["2026-01-01"] * 401},
    ],
    ids=repr,
)
def test_a_bad_record_is_refused(client_logged_in, settings, change):
    assert post(client_logged_in, record(**change)).status_code == 400
    assert rows(settings) == 0


@pytest.mark.parametrize("field", ["id", "game", "day", "seconds", "days"])
def test_a_record_missing_a_field_is_refused(client_logged_in, field):
    body = record()
    del body[field]
    assert post(client_logged_in, body).status_code == 400


def test_a_body_that_is_no_object_is_refused(client_logged_in):
    assert post(client_logged_in, [1]).status_code == 400


def test_lost_is_mahjong_only(client_logged_in):
    assert post(client_logged_in, record(result="lost")).status_code == 400
    assert post(client_logged_in, mahjong(result="lost")).status_code == 204


def test_a_map_is_mahjong_only_and_mahjong_needs_one(client_logged_in):
    assert post(client_logged_in, mahjong(map_id=None)).status_code == 400
    assert post(client_logged_in, mahjong(map_id="nope")).status_code == 400
    assert post(client_logged_in, mahjong()).status_code == 204


def test_solitaire_has_no_level(client_logged_in):
    assert post(client_logged_in, record(game="solitaire", unsolved=None, turns=2)).status_code == 400
    assert post(client_logged_in, record(game="solitaire", level=None, unsolved=None, turns=2)).status_code == 204


def test_no_session_cannot_send_a_record(client, settings):
    assert post(client, record()).status_code in (302, 401)
    assert rows(settings) == 0


def test_a_foreign_origin_cannot_send_a_record(client_logged_in, settings):
    assert post(client_logged_in, record(), {"Origin": "https://elsewhere.example"}).status_code == 403
    assert rows(settings) == 0
