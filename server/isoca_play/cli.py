"""Command line: `isoca-play set-password`. The database is read from DB_PATH."""

from __future__ import annotations

import argparse
import getpass
import os
import sys

from argon2 import PasswordHasher

from . import db

MIN_LENGTH = 12


def set_password() -> int:
    path = os.environ.get("DB_PATH")
    if not path:
        print("DB_PATH is not set", file=sys.stderr)
        return 1
    password = getpass.getpass("New password: ")
    again = getpass.getpass("Again: ")
    if password != again:
        print("The two passwords differ; nothing changed", file=sys.stderr)
        return 1
    if len(password) < MIN_LENGTH:
        print(f"Use at least {MIN_LENGTH} characters; nothing changed", file=sys.stderr)
        return 1
    hashed = PasswordHasher().hash(password)  # argon2id
    conn = db.connect(path)
    try:
        # One transaction: the new hash and the end of every old session.
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                "INSERT INTO account (id, password_hash) VALUES (1, ?) "
                "ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash",
                (hashed,),
            )
            conn.execute("DELETE FROM session")
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()
    print("Password set; all sessions ended")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="isoca-play")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("set-password", help="set the one account's password")
    args = parser.parse_args(argv)
    if args.command == "set-password":
        return set_password()
    return 2


if __name__ == "__main__":
    sys.exit(main())
