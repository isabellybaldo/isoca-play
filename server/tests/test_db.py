import sqlite3
import threading

import pytest

from isoca_play import db


def test_migrations_are_repeatable(tmp_path):
    path = tmp_path / "play.db"
    db.connect(path).close()
    conn = db.connect(path)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == len(db.MIGRATIONS)
    conn.close()


def test_tables_exist_and_pragmas_are_set(tmp_path):
    conn = db.connect(tmp_path / "play.db")
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"account", "session", "failure", "save"} <= tables
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    conn.close()


def test_data_survives_a_second_connect(tmp_path):
    path = tmp_path / "play.db"
    conn = db.connect(path)
    conn.execute("INSERT INTO save (game, body, updated_at) VALUES ('sudoku', '{}', 5)")
    conn.close()
    conn = db.connect(path)
    assert conn.execute("SELECT game, body, updated_at FROM save").fetchall() == [("sudoku", "{}", 5.0)]
    conn.close()


def test_account_holds_only_row_one(tmp_path):
    conn = db.connect(tmp_path / "play.db")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO account (id, password_hash) VALUES (2, 'x')")
    conn.close()


def test_a_new_migration_is_applied_on_top_of_an_old_database(tmp_path, monkeypatch):
    path = tmp_path / "play.db"
    db.connect(path).close()
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS + ["ALTER TABLE save ADD COLUMN note TEXT;"])
    conn = db.connect(path)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == len(db.MIGRATIONS)
    assert "note" in [r[1] for r in conn.execute("PRAGMA table_info(save)")]
    conn.close()


def test_a_failing_migration_leaves_nothing_half_applied(tmp_path, monkeypatch):
    path = tmp_path / "play.db"
    db.connect(path).close()
    bad = "CREATE TABLE half (a); INSERT INTO nowhere VALUES (1);"
    monkeypatch.setattr(db, "MIGRATIONS", db.MIGRATIONS + [bad])
    with pytest.raises(sqlite3.Error):
        db.connect(path)
    monkeypatch.undo()
    conn = db.connect(path)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master")}
    assert "half" not in names
    assert conn.execute("PRAGMA user_version").fetchone()[0] == len(db.MIGRATIONS)
    conn.close()


def test_a_connection_can_be_used_from_another_thread(tmp_path):
    conn = db.connect(tmp_path / "play.db")
    out = []
    t = threading.Thread(target=lambda: out.append(conn.execute("SELECT COUNT(*) FROM save").fetchone()[0]))
    t.start()
    t.join()
    assert out == [0]
    conn.close()
