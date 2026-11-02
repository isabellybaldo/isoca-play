import json
import re
from datetime import date, timedelta

import pytest

from conftest import BASE_URL
from isoca_play import db, stats

ORIGIN = {"Origin": BASE_URL}
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


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


# Totals


@pytest.fixture
def conn(settings):
    c = db.connect(settings.db_path)
    yield c
    c.close()


def add(settings, *records):
    for body in records:
        row = stats.validate_record(body)
        assert row is not None, body
        stats._store(settings, row)


def game_totals(conn, game="sudoku"):
    return next(g for g in stats.public_totals(conn)["games"] if g["game"] == game)


def test_no_records_is_none(conn):
    assert stats.public_totals(conn) is None


def test_win_rate_counts_abandoned_games_too(settings, conn):
    add(settings, record(1), record(2, result="abandoned"))
    totals = game_totals(conn)
    assert (totals["played"], totals["won"], totals["abandoned"], totals["win_rate"]) == (2, 1, 1, 50)


def test_times_count_wins_only(settings, conn):
    add(settings, record(1, seconds=100), record(2, seconds=200), record(3, result="abandoned", seconds=5))
    totals = game_totals(conn)
    assert (totals["best_win_seconds"], totals["avg_win_seconds"]) == (100, 150)


def test_returns_and_tips_average_over_all_games(settings, conn):
    add(settings, record(1, returns=4, tips=1), record(2, result="abandoned", returns=0, tips=2))
    totals = game_totals(conn)
    assert (totals["avg_returns"], totals["avg_tips"]) == (2, 2)


def test_levels_are_counted_apart_and_in_order(settings, conn):
    add(settings, record(1, level="hard"), record(2, level="easy", result="abandoned"), record(3, level="hard"))
    levels = game_totals(conn)["levels"]
    assert [(l["level"], l["played"], l["won"]) for l in levels] == [("easy", 1, 0), ("hard", 2, 2)]


def test_maps_list_their_counts_with_the_most_played_first(settings, conn):
    add(
        settings,
        mahjong(1, "frame"),
        mahjong(2, "fort"),
        mahjong(3, "fort", result="lost"),
        mahjong(4, "fort", result="abandoned"),
    )
    maps = stats.public_totals(conn)["maps"]
    assert [m["map"] for m in maps] == ["fort", "frame"]
    assert maps[0]["name"] == "Fort"
    assert (maps[0]["played"], maps[0]["won"], maps[0]["lost"], maps[0]["abandoned"]) == (3, 1, 1, 1)
    assert maps[0]["win_rate"] == 33


def test_a_map_never_won_has_no_time(settings, conn):
    add(settings, mahjong(1, result="lost"))
    only = stats.public_totals(conn)["maps"][0]
    assert only["avg_win_seconds"] is None and only["best_win_seconds"] is None


def test_longest_streak_uses_days_played(settings, conn):
    add(settings, record(1, day="2026-03-03", days=["2026-03-01", "2026-03-02", "2026-03-03"]))
    assert stats.public_totals(conn)["longest_streak"] == 3


def test_a_gap_breaks_a_streak(settings, conn):
    add(settings, record(1, days=["2026-03-01", "2026-03-02"]), record(2, days=["2026-03-02", "2026-03-04"]))
    assert stats.public_totals(conn)["longest_streak"] == 2


@pytest.mark.parametrize("last, streak", [("2026-03-10", 2), ("2026-03-09", 2), ("2026-03-08", 0)])
def test_current_streak_ends_today_or_yesterday(settings, conn, last, streak):
    before = (date.fromisoformat(last) - timedelta(days=1)).isoformat()
    add(settings, record(1, days=[before, last]))
    assert stats.private_totals(conn, date(2026, 3, 10))["current_streak"] == streak


def test_daily_counts_finished_games_by_day(settings, conn):
    add(settings, record(1, day="2026-03-10", days=["2026-03-08", "2026-03-10"]), record(2, day="2026-03-10"), record(3, day="2026-01-01"))
    daily = stats.private_totals(conn, date(2026, 3, 10))["daily"]
    assert len(daily) == 30
    assert daily[-1] == {"day": "2026-03-10", "games": 2}
    assert daily[-3] == {"day": "2026-03-08", "games": 0}


def test_public_totals_hold_no_date(settings, conn):
    add(settings, record(1), mahjong(2), record(3, game="solitaire", level=None, unsolved=None, turns=1))
    assert not DATE.search(json.dumps(stats.public_totals(conn)))


def test_the_stats_route_needs_a_session(client):
    assert client.get("/api/stats", follow_redirects=False).status_code in (302, 401)


def test_the_stats_route_answers_public_and_private(client_logged_in, settings):
    add(settings, record(1, days=["2026-03-10"], day="2026-03-10"))
    r = client_logged_in.get("/api/stats?today=2026-03-10")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["public"]["games"][0]["played"] == 1
    assert body["private"]["current_streak"] == 1
    assert body["private"]["daily"][-1] == {"day": "2026-03-10", "games": 1}


def test_a_malformed_today_uses_the_servers_date(client_logged_in):
    r = client_logged_in.get("/api/stats?today=nope")
    assert r.status_code == 200
    assert len(r.json()["private"]["daily"]) == 30
