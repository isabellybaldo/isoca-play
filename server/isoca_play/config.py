"""Settings, built once at start-up and passed to create_app.

`now` is injected so tests can move the clock (session expiry, login lockout).
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable


@dataclass(frozen=True)
class Settings:
    db_path: Path
    static_dir: Path
    version: str
    now: Callable[[], float] = field(default=time.time)


def from_env() -> Settings:
    """Settings for the real deployment, read from the environment."""
    return Settings(
        db_path=Path(os.environ["DB_PATH"]),
        static_dir=Path(os.environ.get("STATIC_DIR", "web/dist")),
        version=os.environ.get("APP_VERSION", "dev"),
    )
