import pytest
from fastapi.testclient import TestClient

from isoca_play.app import create_app
from isoca_play.config import Settings


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
    return TestClient(create_app(settings))
