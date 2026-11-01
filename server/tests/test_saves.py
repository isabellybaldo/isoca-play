import pytest

from conftest import BASE_URL
from isoca_play import db

ORIGIN = {"Origin": BASE_URL}
LIMIT = 512 * 1024


@pytest.fixture
def client_logged_in(client, sign_in):
    sign_in(client)
    return client


def put(client, game="mahjong", **kwargs):
    kwargs.setdefault("headers", ORIGIN)
    return client.put(f"/api/save/{game}", **kwargs)


def test_save_round_trip(client_logged_in):
    assert client_logged_in.get("/api/save/mahjong").status_code == 204
    body = {"wall": [1, 2, 3], "name": "café", "nested": {"a": None, "b": [True, 1.5]}}
    r = put(client_logged_in, json=body)
    assert r.status_code == 204 and r.content == b""
    got = client_logged_in.get("/api/save/mahjong")
    assert got.status_code == 200
    assert got.headers["content-type"].startswith("application/json")
    assert got.headers["cache-control"] == "no-store"
    assert got.json() == body
    # the two games are separate
    assert client_logged_in.get("/api/save/sudoku").status_code == 204
    assert put(client_logged_in, "sudoku", json={"grid": "53..7"}).status_code == 204
    assert client_logged_in.get("/api/save/sudoku").json() == {"grid": "53..7"}
    assert client_logged_in.get("/api/save/mahjong").json() == body
    assert client_logged_in.get("/api/save/solitaire").status_code == 204
    assert put(client_logged_in, "solitaire", json={"deal": [3, 1, 2]}).status_code == 204
    assert client_logged_in.get("/api/save/solitaire").json() == {"deal": [3, 1, 2]}
    assert client_logged_in.get("/api/save/sudoku").json() == {"grid": "53..7"}


def test_last_save_wins(client_logged_in, settings):
    put(client_logged_in, json={"n": 1})
    put(client_logged_in, json={"n": 2})
    assert client_logged_in.get("/api/save/mahjong").json() == {"n": 2}
    conn = db.connect(settings.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM save").fetchone()[0] == 1
    finally:
        conn.close()


def test_body_over_512_kib_is_refused_with_413(client_logged_in, settings):
    put(client_logged_in, json={"keep": True})
    filler = "x" * (LIMIT - len('{"k":""}'))
    exact = '{"k":"' + filler + '"}'
    assert len(exact.encode()) == LIMIT
    assert put(client_logged_in, content=exact).status_code == 204
    over = '{"k":"' + filler + 'x"}'
    assert put(client_logged_in, content=over).status_code == 413
    # the refused one stored nothing: the last good save is still there
    assert client_logged_in.get("/api/save/mahjong").json()["k"] == filler


def test_the_size_is_checked_from_the_stream_not_only_the_header(client_logged_in):
    # A chunked body carries no Content-Length at all.
    def chunks():
        yield b'{"k":"'
        for _ in range(LIMIT // 1024 + 1):
            yield b"x" * 1024
        yield b'"}'

    r = put(client_logged_in, content=chunks())
    assert r.status_code == 413
    # And a header that lies low does not get a big body through.
    big = b'{"k":"' + b"x" * LIMIT + b'"}'
    r = put(client_logged_in, content=big, headers={**ORIGIN, "Content-Length": "10"})
    assert r.status_code in (400, 413)
    assert client_logged_in.get("/api/save/mahjong").status_code == 204


@pytest.mark.parametrize(
    "raw",
    [b"", b"not json", b"{", b"[1, 2]", b'"text"', b"42", b"null", b"true",
     b'{"n": NaN}', b"\xff\xfe{}", b"[" * 100000],
)
def test_invalid_json_or_a_non_object_is_refused_with_400(client_logged_in, raw):
    put(client_logged_in, json={"keep": 1})
    assert put(client_logged_in, content=raw).status_code == 400
    assert client_logged_in.get("/api/save/mahjong").json() == {"keep": 1}


def test_unknown_game_is_404(client_logged_in):
    for game in ["chess", "Mahjong", "mahjong.json", "%2e%2e"]:
        assert client_logged_in.get(f"/api/save/{game}").status_code == 404
        assert put(client_logged_in, game, json={}).status_code == 404
    # These two are not this route: one resolves to /api/, one to /api/save/sudoku/x. They
    # land on the static mount, which holds nothing there and takes no PUT.
    for game in ["..", "sudoku%2fx"]:
        assert client_logged_in.get(f"/api/save/{game}").status_code == 404
        assert put(client_logged_in, game, json={}).status_code == 405
    assert client_logged_in.get("/api/save/sudoku").status_code == 204


def test_foreign_origin_put_is_refused(client_logged_in, settings):
    r = put(client_logged_in, json={"x": 1}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client_logged_in.get("/api/save/mahjong").status_code == 204


def test_saves_need_a_session(client):
    assert client.get("/api/save/mahjong").status_code == 401
    assert put(client, json={"x": 1}).status_code == 401
