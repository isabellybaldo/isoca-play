"""SQLite access and numbered, additive migrations.

Connections are cheap, so callers open one per request (see app.get_db) and
close it afterwards. The deployment is a single uvicorn worker.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

# Each entry is migration number index+1. Only ever append; never edit one that
# has shipped. The applied count is kept in PRAGMA user_version.
MIGRATIONS: list[str] = [
    """
    CREATE TABLE IF NOT EXISTS account (
        id            INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session (
        token_hash TEXT PRIMARY KEY,
        expires_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS failure (
        ip TEXT NOT NULL,
        at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS failure_ip_at ON failure (ip, at);
    CREATE TABLE IF NOT EXISTS save (
        game       TEXT PRIMARY KEY,
        body       TEXT NOT NULL,
        updated_at REAL NOT NULL
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS game_record (
        id       TEXT PRIMARY KEY,
        game     TEXT NOT NULL,
        level    TEXT,
        result   TEXT NOT NULL,
        day      TEXT NOT NULL,
        days     TEXT NOT NULL,
        seconds  INTEGER NOT NULL,
        returns  INTEGER NOT NULL,
        tips     INTEGER NOT NULL,
        map      TEXT,
        slots    INTEGER,
        moves    INTEGER,
        unsolved INTEGER,
        turns    INTEGER
    );
    """,
]


def connect(path: str | Path) -> sqlite3.Connection:
    """Open the database (creating it), set pragmas, apply pending migrations."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Autocommit mode: transactions are explicit (BEGIN ... COMMIT). The
    # connection may be created and used on different worker threads, but only
    # ever by one request at a time.
    conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    _migrate(conn)
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for number, sql in enumerate(MIGRATIONS, start=1):
        if number <= current:
            continue
        # executescript runs the whole script, BEGIN to COMMIT; user_version
        # changes inside the transaction, so a failure leaves nothing half-applied.
        conn.executescript(f"BEGIN;\n{sql}\nPRAGMA user_version = {number};\nCOMMIT;")
