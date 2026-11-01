import hashlib

import pytest
from fastapi.testclient import TestClient

from isoca_play import db
from isoca_play.app import create_app
from isoca_play.config import Settings

# __Host- cookies need Secure, and a Secure cookie only travels over https.
BASE_URL = "https://testserver"


class Clock:
    """A movable clock for Settings.now."""

    def __init__(self, t: float = 1_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def settings(tmp_path, clock):
    return Settings(
        db_path=tmp_path / "play.db",
        static_dir=tmp_path / "static",
        version="test",
        now=clock,
    )


@pytest.fixture
def client(settings):
    return TestClient(create_app(settings), base_url=BASE_URL)


@pytest.fixture
def sign_in(settings, clock):
    """Give a client a live session without paying for a password check."""

    def give_session(c: TestClient) -> None:
        token = "t" * 43
        conn = db.connect(settings.db_path)
        conn.execute(
            "INSERT OR REPLACE INTO session (token_hash, expires_at) VALUES (?, ?)",
            (hashlib.sha256(token.encode()).hexdigest(), clock() + 3600),
        )
        conn.close()
        c.cookies.set("__Host-session", token)

    return give_session
