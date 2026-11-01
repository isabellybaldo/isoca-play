"""Login, sessions and the guard in front of everything else.

Without a session, every path answers the login page, or 401 under /api. Only
PUBLIC_PATHS are reachable. The guard is ASGI middleware, so nothing behind it
(routes, a later static mount) can be reached by accident.

Login attempts are processed one at a time behind a small queue. That is what
keeps Argon2's 64 MiB from adding up against the container's 256 MB cap, and it
also makes the block and slowdown checks race-free in the single worker: each
attempt sees the failure the previous one recorded. All limits are read from the
failure table, so a restart clears none of them.
"""

from __future__ import annotations

import asyncio
import functools
import hashlib
import hmac
import logging
import secrets
import sqlite3
from pathlib import Path
from urllib.parse import parse_qs

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, InvalidHashError
from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from starlette.concurrency import run_in_threadpool
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import db
from .config import Settings

log = logging.getLogger(__name__)

COOKIE = "__Host-session"
TOKEN_BYTES = 32  # 256 bits
TOKEN_LENGTH = 43  # token_urlsafe(32); any other cookie is not worth a database call
SESSION_SECONDS = 30 * 86400
RENEW_EVERY = 86400  # at most one write a day per session

BLOCK_AFTER = 5
BLOCK_SECONDS = 15 * 60
WIDE_AFTER = 20  # failures in WIDE_WINDOW, site-wide, before the slowdown starts
WIDE_WINDOW = 3600
WIDE_INTERVAL = 5  # seconds between processed attempts during the slowdown
MAX_WAITING = 8  # attempts held at once, the running one included; the rest are refused
MAX_BODY = 4096
MAX_IP_LENGTH = 64  # the longest IPv6 text is 45

WRONG_MESSAGE = "That is not the password."
BLOCKED_MESSAGE = "Too many tries. Try again later."
SLOW_MESSAGE = "Busy right now. Try again shortly."

PUBLIC_DIR = Path(__file__).parent / "public"
FONTS = ("vt323-latin-400-normal.woff2", "press-start-2p-latin-400-normal.woff2")
# Exact paths only. A prefix check on /fonts/ would also pass /fonts/../index.html,
# which a static mount behind the guard would normalise and serve.
PUBLIC_PATHS = frozenset(
    {"/login", "/login.css", "/healthz", *(f"/fonts/{name}" for name in FONTS)}
)
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
NO_STORE = {"Cache-Control": "no-store"}

_hasher = PasswordHasher()  # the same parameters the set-password command uses


def client_ip(request: Request) -> str:
    """The rightmost X-Forwarded-For entry, the one Traefik appended.

    Everything to its left came from the client, so it can be spoofed.
    """
    forwarded = request.headers.getlist("x-forwarded-for")
    ip = forwarded[-1].rsplit(",", 1)[-1].strip() if forwarded else ""
    if not ip:
        ip = request.client.host if request.client else "unknown"
    return ip[:MAX_IP_LENGTH]


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _session_cookie(token: str) -> str:
    return f"{COOKIE}={token}; Max-Age={SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Strict"


def _ended_cookie() -> str:
    return f"{COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict"


# Password checking


@functools.cache
def _dummy_hash() -> str:
    """Checked when no password is set, so the timing doesn't reveal that state."""
    return _hasher.hash(secrets.token_urlsafe(TOKEN_BYTES))


def _verify(stored: str, password: str) -> bool:
    try:
        return _hasher.verify(stored, password)
    except (Argon2Error, InvalidHashError):
        return False


def _is_blocked(conn: sqlite3.Connection, ip: str, now: float) -> bool:
    """Five failures within the window, and the last of them under 15 minutes ago."""
    latest = conn.execute(
        "SELECT at FROM failure WHERE ip = ? ORDER BY at DESC LIMIT ?", (ip, BLOCK_AFTER)
    ).fetchall()
    if len(latest) < BLOCK_AFTER:
        return False
    newest, oldest = latest[0][0], latest[-1][0]
    return newest - oldest <= BLOCK_SECONDS and now - newest < BLOCK_SECONDS


def _is_slowed(conn: sqlite3.Connection, now: float) -> bool:
    count, last = conn.execute(
        "SELECT COUNT(*), MAX(at) FROM failure WHERE at > ?", (now - WIDE_WINDOW,)
    ).fetchone()
    return count > WIDE_AFTER and now - last < WIDE_INTERVAL


def _record_failure(conn: sqlite3.Connection, ip: str, now: float) -> None:
    # Pruning here keeps the table small: a refused attempt writes nothing, and the
    # slowdown limits what gets this far to about one row per 5 seconds.
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM failure WHERE at <= ?", (now - WIDE_WINDOW,))
        conn.execute("INSERT INTO failure (ip, at) VALUES (?, ?)", (ip, now))
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def _start_session(conn: sqlite3.Connection, ip: str, now: float, old_token: str | None) -> str:
    token = secrets.token_urlsafe(TOKEN_BYTES)
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM failure WHERE ip = ?", (ip,))
        conn.execute("DELETE FROM session WHERE expires_at <= ?", (now,))
        if old_token:
            conn.execute("DELETE FROM session WHERE token_hash = ?", (_hash_token(old_token),))
        conn.execute(
            "INSERT INTO session (token_hash, expires_at) VALUES (?, ?)",
            (_hash_token(token), now + SESSION_SECONDS),
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return token


def _attempt(settings: Settings, ip: str, password: str, old_token: str | None) -> str | Response:
    """One login attempt, on a worker thread, one at a time. A new token, or the refusal."""
    now = settings.now()
    conn = db.connect(settings.db_path)
    try:
        if _is_blocked(conn, ip, now):
            return _login_page(BLOCKED_MESSAGE, 401)
        if _is_slowed(conn, now):
            return _try_shortly()
        row = conn.execute("SELECT password_hash FROM account WHERE id = 1").fetchone()
        matches = _verify(row[0] if row else _dummy_hash(), password)
        if not (matches and row):
            _record_failure(conn, ip, now)
            log.warning("login failure from %r", ip)
            return _login_page(WRONG_MESSAGE, 401)
        return _start_session(conn, ip, now, old_token)
    finally:
        conn.close()


# Sessions


def _check_session(settings: Settings, token: str) -> tuple[bool, bool]:
    """Is this token a live session, and did this call renew it?"""
    now = settings.now()
    token_hash = _hash_token(token)
    conn = db.connect(settings.db_path)
    try:
        row = conn.execute(
            "SELECT token_hash, expires_at FROM session WHERE token_hash = ?", (token_hash,)
        ).fetchone()
        if row is None or not hmac.compare_digest(row[0], token_hash):
            return False, False
        expires_at = row[1]
        if expires_at <= now:
            conn.execute("DELETE FROM session WHERE token_hash = ?", (token_hash,))
            return False, False
        if now + SESSION_SECONDS - expires_at < RENEW_EVERY:
            return True, False
        # Rowcount: a logout on another request may have just removed it.
        renewed = conn.execute(
            "UPDATE session SET expires_at = ? WHERE token_hash = ?",
            (now + SESSION_SECONDS, token_hash),
        ).rowcount
        return renewed == 1, renewed == 1
    finally:
        conn.close()


def _origin_allowed(request: Request) -> bool:
    """Is this state-changing request from our own page?

    Traefik terminates TLS, so the scheme is always https here. X-Forwarded-Proto
    is the client's to forge, so it is never read. A browser sends Origin on every
    state-changing request; with none, only Sec-Fetch-Site: same-origin will do.
    """
    origin = request.headers.get("origin")
    if origin is None:
        return request.headers.get("sec-fetch-site") == "same-origin"
    host = request.headers.get("host")
    return bool(host) and hmac.compare_digest(
        origin.lower().encode(), f"https://{host}".lower().encode()
    )


def require_session(app: ASGIApp) -> ASGIApp:
    """The guard: ASGI middleware around the whole application."""

    async def guard(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await app(scope, receive, send)
            return

        if scope["type"] != "http":  # the site has no websockets; refuse them all
            await send({"type": "websocket.close", "code": 1008})
            return

        request = Request(scope)
        settings: Settings = scope["app"].state.settings
        path = scope["path"]

        if scope["method"] not in SAFE_METHODS and not _origin_allowed(request):
            response = JSONResponse({"detail": "Forbidden"}, 403, headers=NO_STORE)
            await response(scope, receive, send)
            return

        token = request.cookies.get(COOKIE)
        signed_in = renewed = False
        if token is not None and len(token) == TOKEN_LENGTH:
            signed_in, renewed = await run_in_threadpool(_check_session, settings, token)
        scope.setdefault("state", {})["signed_in"] = signed_in

        if not signed_in and path not in PUBLIC_PATHS:
            if path == "/api" or path.startswith("/api/"):
                response = JSONResponse({"detail": "Not signed in"}, 401, headers=NO_STORE)
            else:
                response = RedirectResponse("/login", 302, headers=NO_STORE)
            await response(scope, receive, send)
            return

        if not renewed:
            await app(scope, receive, send)
            return

        async def send_with_renewal(message: Message) -> None:
            # Login and logout set this cookie themselves; a renewal after theirs
            # would win in the browser and undo them.
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                name = f"{COOKIE}=".encode()
                if not any(k == b"set-cookie" and v.startswith(name) for k, v in headers):
                    headers.append((b"set-cookie", _session_cookie(token).encode()))
            await send(message)

        await app(scope, receive, send_with_renewal)

    return guard


# Pages


@functools.cache
def _login_template() -> str:
    return (PUBLIC_DIR / "login.html").read_text(encoding="utf-8")


def _login_page(message: str, status: int, headers: dict[str, str] | None = None) -> HTMLResponse:
    # Messages are the constants above; nothing from the request reaches the page.
    shown = f'<p class="message" role="alert">{message}</p>' if message else ""
    html = _login_template().replace("<!--message-->", shown)
    return HTMLResponse(html, status, headers={**NO_STORE, **(headers or {})})


def _try_shortly() -> HTMLResponse:
    return _login_page(SLOW_MESSAGE, 429, {"Retry-After": str(WIDE_INTERVAL)})


async def _read_password(request: Request) -> str | None:
    """The form's password field, or None if the body is over the cap."""
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_BODY:
            return None
    try:
        form = parse_qs(body.decode("ascii", "replace"), keep_blank_values=True, max_num_fields=8)
    except ValueError:
        return ""
    return form.get("password", [""])[0]


class _LoginGate:
    """One attempt runs at a time; a few wait, cheaply, on the event loop; the rest
    are refused at once. Nothing holds a thread while it waits."""

    def __init__(self) -> None:
        self.semaphore = asyncio.Semaphore(1)
        self.inside = 0


router = APIRouter()


@router.get("/login")
def login_page(request: Request) -> Response:
    if request.state.signed_in:
        return RedirectResponse("/", 302, headers=NO_STORE)
    return _login_page("", 200)


@router.post("/login")
async def login(request: Request) -> Response:
    password = await _read_password(request)
    if password is None:
        return JSONResponse({"detail": "Too large"}, 413, headers=NO_STORE)

    gate: _LoginGate = request.app.state.login_gate
    if gate.inside >= MAX_WAITING:
        return _try_shortly()
    gate.inside += 1
    try:
        async with gate.semaphore:
            outcome = await run_in_threadpool(
                _attempt,
                request.app.state.settings,
                client_ip(request),
                password,
                request.cookies.get(COOKIE),
            )
    finally:
        gate.inside -= 1

    if isinstance(outcome, Response):
        return outcome
    response = RedirectResponse("/", 303, headers=NO_STORE)
    response.headers.append("set-cookie", _session_cookie(outcome))
    return response


@router.post("/logout")
def logout(request: Request) -> Response:
    # The guard has already seen a live session, so the cookie is here.
    conn = db.connect(request.app.state.settings.db_path)
    try:
        conn.execute(
            "DELETE FROM session WHERE token_hash = ?",
            (_hash_token(request.cookies[COOKIE]),),
        )
    finally:
        conn.close()
    response = RedirectResponse("/login", 303, headers=NO_STORE)
    response.headers.append("set-cookie", _ended_cookie())
    return response


@router.get("/login.css")
def login_css() -> FileResponse:
    return FileResponse(PUBLIC_DIR / "login.css", media_type="text/css")


@router.get("/fonts/{name}")
def font(name: str) -> Response:
    # The guard lets only the FONTS paths through without a session; this keeps a
    # signed-in request to the same few files.
    if name not in FONTS:
        return Response(status_code=404)
    return FileResponse(PUBLIC_DIR / "fonts" / name, media_type="font/woff2")


def install(app: FastAPI) -> None:
    app.state.login_gate = _LoginGate()
    app.include_router(router)
    app.add_middleware(require_session)
