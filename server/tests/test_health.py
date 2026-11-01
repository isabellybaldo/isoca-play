import sqlite3

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from conftest import BASE_URL
from isoca_play.app import app_from_env, create_app, get_db


def test_healthz_is_public_and_names_the_version(client):
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json() == {"version": "test"}


def test_the_image_entry_point_reads_the_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "play.db"))
    monkeypatch.setenv("STATIC_DIR", str(tmp_path / "static"))
    monkeypatch.setenv("APP_VERSION", "abc123")
    r = TestClient(app_from_env(), base_url=BASE_URL).get("/healthz")
    assert r.json() == {"version": "abc123"}


def test_settings_now_is_injectable(settings, clock):
    assert settings.now() == 1_000_000.0
    clock.advance(60)
    assert settings.now() == 1_000_060.0


def test_api_docs_are_not_exposed(client, sign_in):
    sign_in(client)
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_get_db_gives_a_connection_per_request_and_closes_it(settings, sign_in):
    app = create_app(settings)
    seen = []

    @app.get("/probe")
    def probe(conn=Depends(get_db)):
        seen.append(conn)
        return {"n": conn.execute("SELECT COUNT(*) FROM save").fetchone()[0]}

    # Routes answer in order, and the static mount at / is last and takes everything.
    app.router.routes.insert(0, app.router.routes.pop())

    c = TestClient(app, base_url=BASE_URL)
    sign_in(c)
    assert c.get("/probe").json() == {"n": 0}
    assert c.get("/probe").json() == {"n": 0}
    assert seen[0] is not seen[1]
    with pytest.raises(sqlite3.ProgrammingError):
        seen[0].execute("SELECT 1")
