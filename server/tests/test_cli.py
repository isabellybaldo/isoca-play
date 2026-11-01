import getpass

import pytest
from argon2 import PasswordHasher

from isoca_play import cli, db

GOOD = "correct horse battery"


@pytest.fixture
def dbfile(tmp_path, monkeypatch):
    path = tmp_path / "play.db"
    monkeypatch.setenv("DB_PATH", str(path))
    return path


def typed(monkeypatch, *answers):
    queue = list(answers)
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": queue.pop(0))


def rows(path, sql):
    conn = db.connect(path)
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


def test_set_password_stores_argon2_and_ends_sessions(dbfile, monkeypatch):
    conn = db.connect(dbfile)
    conn.execute("INSERT INTO session (token_hash, expires_at) VALUES ('a', 9e9), ('b', 9e9)")
    conn.close()
    typed(monkeypatch, GOOD, GOOD)
    assert cli.main(["set-password"]) == 0
    (stored,) = rows(dbfile, "SELECT password_hash FROM account WHERE id = 1")[0]
    assert stored.startswith("$argon2id$")
    assert PasswordHasher().verify(stored, GOOD)
    assert rows(dbfile, "SELECT * FROM session") == []


def test_set_password_again_replaces_the_hash(dbfile, monkeypatch):
    typed(monkeypatch, GOOD, GOOD, GOOD + "!", GOOD + "!")
    assert cli.main(["set-password"]) == 0
    assert cli.main(["set-password"]) == 0
    (stored,) = rows(dbfile, "SELECT password_hash FROM account")[0]
    assert PasswordHasher().verify(stored, GOOD + "!")
    assert len(rows(dbfile, "SELECT * FROM account")) == 1


def test_set_password_refuses_under_12_characters(dbfile, monkeypatch, capsys):
    conn = db.connect(dbfile)
    conn.execute("INSERT INTO session (token_hash, expires_at) VALUES ('a', 9e9)")
    conn.close()
    typed(monkeypatch, "elevenchars", "elevenchars")
    assert cli.main(["set-password"]) == 1
    assert rows(dbfile, "SELECT * FROM account") == []
    assert len(rows(dbfile, "SELECT * FROM session")) == 1
    assert "12" in capsys.readouterr().err


def test_set_password_accepts_exactly_12_characters(dbfile, monkeypatch):
    typed(monkeypatch, "twelve chars", "twelve chars")
    assert cli.main(["set-password"]) == 0


def test_set_password_refuses_a_mismatch(dbfile, monkeypatch, capsys):
    typed(monkeypatch, GOOD, GOOD + "x")
    assert cli.main(["set-password"]) == 1
    assert rows(dbfile, "SELECT * FROM account") == []
    assert "differ" in capsys.readouterr().err


def test_set_password_needs_db_path(monkeypatch, capsys):
    monkeypatch.delenv("DB_PATH", raising=False)
    typed(monkeypatch, GOOD, GOOD)
    assert cli.main(["set-password"]) == 1
    assert "DB_PATH" in capsys.readouterr().err
