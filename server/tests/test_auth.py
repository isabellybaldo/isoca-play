import asyncio
import hashlib
import logging
import re
import time

import httpx
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from starlette.requests import Request
from starlette.websockets import WebSocketDisconnect

from conftest import BASE_URL
from isoca_play import auth, db
from isoca_play.app import create_app

PASSWORD = "correct horse battery"
WRONG = "not the password at all"
COOKIE = "__Host-session"
DAY = 86400
ORIGIN = {"Origin": BASE_URL}
# Past the guard, but no such route: 404 means alive, 401 means no session.
LIVE_PROBE = "/api/no-such-route"


@pytest.fixture
def database(settings):
    conn = db.connect(settings.db_path)
    yield conn
    conn.close()


@pytest.fixture
def password_set(database):
    database.execute(
        "INSERT INTO account (id, password_hash) VALUES (1, ?)",
        (PasswordHasher().hash(PASSWORD),),
    )


def post_login(client, password=PASSWORD, ip="203.0.113.7", **headers):
    sent = {"X-Forwarded-For": ip, **ORIGIN, **headers}
    return client.post(
        "/login", data={"password": password}, headers=sent, follow_redirects=False
    )


def fail_times(client, n, ip="203.0.113.7"):
    for _ in range(n):
        assert post_login(client, WRONG, ip).status_code == 401


def is_alive(client):
    return client.get(LIVE_PROBE).status_code == 404


def set_cookies(response):
    return [v for k, v in response.headers.multi_items() if k == "set-cookie"]


def cookie_value(response):
    return set_cookies(response)[0].split(";")[0].split("=", 1)[1]


def rows(database, table):
    return database.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


# The guard


def test_no_session_gets_the_login_page_everywhere(client):
    for path in ["/", "/assets/x.js", "/sw.js", "/login/", "/fonts/nope.woff2"]:
        r = client.get(path, follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"] == "/login"
    for path in ["/api", "/api/save/mahjong"]:
        assert client.get(path).status_code == 401


def test_only_the_named_paths_are_public(client):
    assert client.get("/login").status_code == 200
    assert client.get("/healthz").status_code == 200
    css = client.get("/login.css")
    assert css.status_code == 200 and css.headers["content-type"].startswith("text/css")
    assert len(auth.FONTS) == 2
    for name in auth.FONTS:
        font = client.get(f"/fonts/{name}")
        assert font.status_code == 200 and font.headers["content-type"] == "font/woff2"


def test_a_dotted_path_does_not_slip_through_a_public_prefix(client):
    # Sent raw: the static mount behind the guard would normalise this into the app.
    # test_static.py holds the same for /assets/ and its encodings, with a real build.
    for raw in [b"/fonts/../assets/x.js", b"/fonts/..%2fassets/x.js"]:
        url = httpx.URL(BASE_URL).copy_with(raw_path=raw)
        r = client.get(url, follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"] == "/login"


def test_a_made_up_or_oversized_cookie_is_no_session(client):
    for token in ["t" * 43, "x", "y" * 5000]:
        client.cookies.set(COOKIE, token)
        assert client.get(LIVE_PROBE).status_code == 401
        client.cookies.clear()


def test_a_websocket_is_refused_session_or_not(client, sign_in):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/anything"):
            pass
    sign_in(client)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/anything"):
            pass


# Login and the cookie


def test_right_password_sets_the_cookie(client, password_set):
    r = post_login(client)
    assert r.status_code == 303 and r.headers["location"] == "/#logged-in"
    [cookie] = set_cookies(r)
    parts = [p.strip() for p in cookie.split(";")]
    assert parts[0].startswith(f"{COOKIE}=")
    assert {"Secure", "HttpOnly", "SameSite=Strict", "Path=/"} <= set(parts)
    assert not any(p.lower().startswith("domain") for p in parts)
    max_age = next(int(p.split("=")[1]) for p in parts if p.startswith("Max-Age="))
    assert 29 * DAY <= max_age <= 31 * DAY
    assert is_alive(client)


def test_wrong_password_answers_the_page_and_no_cookie(client, password_set):
    r = post_login(client, WRONG)
    assert r.status_code == 401
    assert "<form" in r.text and auth.WRONG_MESSAGE in r.text
    assert set_cookies(r) == []
    assert not is_alive(client)


def test_a_form_with_no_password_field_is_a_plain_failure(client, password_set, database):
    r = client.post("/login", data={"other": "x"}, headers=ORIGIN, follow_redirects=False)
    assert r.status_code == 401 and rows(database, "failure") == 1


def test_an_oversized_body_is_refused_without_a_check(client, password_set, monkeypatch):
    monkeypatch.setattr(auth, "_verify", lambda *a: pytest.fail("verified"))
    assert post_login(client, "x" * (auth.MAX_BODY + 1)).status_code == 413


def test_the_token_is_stored_hashed(client, password_set, database):
    token = cookie_value(post_login(client))
    assert len(token) >= 43  # 256 bits in url-safe base64
    [(stored,)] = database.execute("SELECT token_hash FROM session").fetchall()
    assert stored == hashlib.sha256(token.encode()).hexdigest()
    assert token not in stored


def test_login_rotates_to_a_fresh_token(client, password_set, database):
    old = cookie_value(post_login(client))
    r = post_login(client)
    assert r.status_code == 303
    assert cookie_value(r) != old
    assert rows(database, "session") == 1
    client.cookies.clear()
    client.cookies.set(COOKIE, old)
    assert not is_alive(client)


def test_login_clears_expired_sessions(client, password_set, database, clock):
    database.execute(
        "INSERT INTO session (token_hash, expires_at) VALUES ('old', ?)", (clock() - 1,)
    )
    post_login(client)
    assert rows(database, "session") == 1


def test_a_signed_in_visit_to_login_goes_home(client, sign_in):
    sign_in(client)
    r = client.get("/login", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/"


# Renewal and expiry


def test_session_renews_on_use_and_expires_after_30_days(client, password_set, clock):
    post_login(client)
    for _ in range(40):  # used daily, it outlives 30 days
        clock.advance(DAY + 1)
        assert is_alive(client)
    clock.advance(30 * DAY)  # left alone, it does not
    assert not is_alive(client)


def test_renewal_writes_at_most_once_a_day(client, password_set, database, clock):
    post_login(client)

    def expiry():
        return database.execute("SELECT expires_at FROM session").fetchone()[0]

    before = expiry()
    clock.advance(DAY - 10)
    r = client.get(LIVE_PROBE)
    assert r.status_code == 404 and set_cookies(r) == [] and expiry() == before
    clock.advance(11)
    r = client.get(LIVE_PROBE)
    assert expiry() == clock() + 30 * DAY
    [cookie] = set_cookies(r)
    assert cookie.startswith(f"{COOKIE}=") and "Max-Age=2592000" in cookie


def test_an_expired_session_row_is_removed_on_sight(client, password_set, database, clock):
    post_login(client)
    clock.advance(30 * DAY)
    assert not is_alive(client)
    assert rows(database, "session") == 0


# The per-IP block


def test_five_failures_block_the_ip_for_15_minutes(client, password_set, clock):
    fail_times(client, 5)
    r = post_login(client)  # the right password fails while blocked
    assert r.status_code == 401 and set_cookies(r) == []
    clock.advance(15 * 60 - 1)
    assert post_login(client).status_code == 401
    clock.advance(1)
    assert post_login(client).status_code == 303


def test_four_failures_do_not_block(client, password_set):
    fail_times(client, 4)
    assert post_login(client).status_code == 303


def test_a_late_fifth_failure_still_blocks_for_the_full_15_minutes(client, password_set, clock):
    fail_times(client, 4)
    clock.advance(800)
    fail_times(client, 1)
    clock.advance(899)
    assert post_login(client).status_code == 401
    clock.advance(1)
    assert post_login(client).status_code == 303


def test_failures_spread_over_more_than_the_window_do_not_block(client, password_set, clock):
    for _ in range(6):
        fail_times(client, 1)
        clock.advance(300)
    assert post_login(client).status_code == 303


def test_a_blocked_answer_does_not_reveal_the_password(client, password_set, monkeypatch):
    fail_times(client, 5)
    monkeypatch.setattr(auth, "_verify", lambda *a: pytest.fail("verified"))
    right, wrong = post_login(client), post_login(client, WRONG)
    assert right.status_code == wrong.status_code == 401
    assert right.content == wrong.content and set_cookies(right) == []
    assert auth.BLOCKED_MESSAGE in right.text


def test_a_blocked_answer_differs_from_a_wrong_one_only_in_its_message(client, password_set):
    wrong = post_login(client, WRONG, "198.51.100.9")
    fail_times(client, 5)
    blocked = post_login(client)
    assert blocked.status_code == wrong.status_code
    assert blocked.headers["content-type"] == wrong.headers["content-type"]
    assert blocked.text.replace(auth.BLOCKED_MESSAGE, auth.WRONG_MESSAGE) == wrong.text


def test_being_blocked_writes_nothing(client, password_set, database):
    fail_times(client, 5)
    post_login(client)
    assert rows(database, "failure") == 5


def test_spoofed_forwarded_for_does_not_dodge_the_block(client, password_set):
    for i in range(5):
        spoof = f"10.0.0.{i}, 203.0.113.7"
        assert post_login(client, WRONG, spoof).status_code == 401
    r = post_login(client, PASSWORD, "10.9.9.9, 203.0.113.7")
    assert r.status_code == 401 and auth.BLOCKED_MESSAGE in r.text
    assert post_login(client, PASSWORD, "203.0.113.8").status_code == 303


def test_client_ip_reads_the_last_entry_of_the_last_header():
    def ip(*forwarded, client=("192.0.2.1", 1)):
        headers = [(b"x-forwarded-for", v.encode()) for v in forwarded]
        return auth.client_ip(Request({"type": "http", "headers": headers, "client": client}))

    assert ip("1.1.1.1, 2.2.2.2") == "2.2.2.2"
    assert ip("1.1.1.1", "3.3.3.3, 4.4.4.4 ") == "4.4.4.4"
    assert ip() == "192.0.2.1"
    assert ip("1.1.1.1, ") == "192.0.2.1"  # a blank last entry names no one
    assert ip(client=None) == "unknown"
    assert len(ip("9" * 5000)) == auth.MAX_IP_LENGTH


def test_a_restart_does_not_clear_a_block(settings, client, password_set):
    fail_times(client, 5)
    reborn = TestClient(create_app(settings), base_url=BASE_URL)
    assert post_login(reborn).status_code == 401


def test_success_clears_that_ips_failures_only(client, password_set, database):
    fail_times(client, 4)
    fail_times(client, 2, ip="198.51.100.9")
    post_login(client)
    assert database.execute("SELECT DISTINCT ip FROM failure").fetchall() == [("198.51.100.9",)]


def test_an_existing_session_keeps_working_during_a_block(client, password_set, settings):
    post_login(client)
    attacker = TestClient(create_app(settings), base_url=BASE_URL)
    fail_times(attacker, 5)
    assert is_alive(client)


# Storage stays bounded, and logs stay clean


def test_old_failures_are_deleted(client, password_set, database, clock):
    fail_times(client, 3)
    clock.advance(3601)
    fail_times(client, 1, ip="198.51.100.9")
    assert database.execute("SELECT ip FROM failure").fetchall() == [("198.51.100.9",)]


def test_a_stored_ip_is_capped(client, password_set, database):
    post_login(client, WRONG, "9" * 5000)
    [(ip,)] = database.execute("SELECT ip FROM failure").fetchall()
    assert len(ip) == auth.MAX_IP_LENGTH


def test_failures_are_logged_without_the_password(client, password_set, caplog):
    with caplog.at_level(logging.INFO, logger="isoca_play.auth"):
        post_login(client, WRONG)
    assert "203.0.113.7" in caplog.text
    assert WRONG not in caplog.text and PASSWORD not in caplog.text


# The site-wide slowdown


def wide_attack(client, failures=21):
    for i in range(failures):
        assert post_login(client, WRONG, f"10.1.0.{i}").status_code == 401


def test_wide_attack_slows_logins_but_a_session_still_works(client, password_set, clock, settings):
    post_login(client, ip="198.51.100.1")
    attacker = TestClient(create_app(settings), base_url=BASE_URL)
    wide_attack(attacker)
    r = post_login(attacker, ip="198.51.100.2")
    assert r.status_code == 429 and auth.SLOW_MESSAGE in r.text
    assert r.headers["retry-after"] == "5" and set_cookies(r) == []
    assert is_alive(client)
    clock.advance(5)  # one attempt per 5 seconds gets through
    assert post_login(attacker, ip="198.51.100.2").status_code == 303


def test_twenty_failures_do_not_slow_anyone(client, password_set):
    wide_attack(client, 20)
    assert post_login(client, ip="198.51.100.2").status_code == 303


def test_the_slowdown_refuses_without_a_check_and_writes_nothing(
    client, password_set, database, monkeypatch
):
    wide_attack(client)
    monkeypatch.setattr(auth, "_verify", lambda *a: pytest.fail("verified"))
    assert post_login(client, ip="198.51.100.2").status_code == 429
    assert rows(database, "failure") == 21


def test_the_slowdown_refuses_at_once_rather_than_sleeping(client, password_set):
    wide_attack(client)
    started = time.monotonic()
    assert post_login(client, ip="198.51.100.2").status_code == 429
    assert time.monotonic() - started < 2


def test_the_slowdown_ends_when_the_hour_passes(client, password_set, clock):
    wide_attack(client)
    clock.advance(3601)
    assert post_login(client, ip="198.51.100.2").status_code == 303


def test_a_restart_does_not_clear_the_slowdown(settings, client, password_set):
    wide_attack(client)
    reborn = TestClient(create_app(settings), base_url=BASE_URL)
    assert post_login(reborn, ip="198.51.100.2").status_code == 429


# The check itself runs one at a time, and a crowd is turned away


def concurrent_logins(settings, count, one_ip=None):
    async def go():
        transport = httpx.ASGITransport(app=create_app(settings))
        async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as c:
            return await asyncio.gather(
                *(
                    c.post(
                        "/login",
                        data={"password": WRONG},
                        headers={"X-Forwarded-For": one_ip or f"10.2.0.{i}", **ORIGIN},
                    )
                    for i in range(count)
                )
            )

    return asyncio.run(go())


def test_the_password_check_runs_one_at_a_time(settings, password_set, monkeypatch):
    running, most = [0], [0]

    def slow_verify(stored, password):
        running[0] += 1
        most[0] = max(most[0], running[0])
        time.sleep(0.01)
        running[0] -= 1
        return False

    monkeypatch.setattr(auth, "_verify", slow_verify)
    answers = concurrent_logins(settings, auth.MAX_WAITING)
    assert [a.status_code for a in answers] == [401] * auth.MAX_WAITING
    assert most[0] == 1


def test_a_crowd_past_the_queue_is_refused_fast(settings, password_set, monkeypatch):
    calls = []

    def slow_verify(stored, password):
        calls.append(1)
        time.sleep(0.01)
        return False

    monkeypatch.setattr(auth, "_verify", slow_verify)
    answers = concurrent_logins(settings, auth.MAX_WAITING + 5)
    codes = [a.status_code for a in answers]
    assert codes.count(429) == 5 and codes.count(401) == auth.MAX_WAITING
    assert len(calls) == auth.MAX_WAITING


def test_a_login_in_flight_does_not_survive_set_password(client, password_set, database):
    def verify_then_password_changes(stored, password):
        other = db.connect(client.app.state.settings.db_path)
        other.execute(
            "UPDATE account SET password_hash = ? WHERE id = 1",
            (PasswordHasher().hash("a new one"),),
        )
        other.close()
        return True  # the check passed against the old hash

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(auth, "_verify", verify_then_password_changes)
        r = post_login(client)
    assert r.status_code == 401 and set_cookies(r) == []
    assert rows(database, "session") == 0
    assert rows(database, "failure") == 1


def test_eight_concurrent_guesses_from_one_ip_leave_five_failures(
    settings, password_set, database
):
    answers = concurrent_logins(settings, auth.MAX_WAITING, one_ip="203.0.113.9")
    assert all(a.status_code == 401 for a in answers)
    assert database.execute(
        "SELECT COUNT(*) FROM failure WHERE ip = ?", ("203.0.113.9",)
    ).fetchone()[0] == auth.BLOCK_AFTER == 5
    assert rows(database, "failure") == 5


# Origin


def test_login_refuses_a_foreign_origin(client, password_set, database):
    for origin in [
        "https://evil.example",
        "http://testserver",  # the wrong scheme
        "https://testserver.evil.example",
        "https://evil.testserver",
        "null",
    ]:
        r = post_login(client, Origin=origin)
        assert r.status_code == 403 and set_cookies(r) == []
    assert rows(database, "failure") == 0


def test_a_forwarded_proto_cannot_change_the_expected_origin(client, password_set):
    r = post_login(client, Origin="http://testserver", **{"X-Forwarded-Proto": "http"})
    assert r.status_code == 403


def test_a_missing_origin_needs_sec_fetch_site_same_origin(client, password_set):
    def send(**headers):
        return client.post(
            "/login",
            data={"password": PASSWORD},
            headers={"X-Forwarded-For": "203.0.113.7", **headers},
            follow_redirects=False,
        )

    assert send().status_code == 403
    assert send(**{"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert send(**{"Sec-Fetch-Site": "same-site"}).status_code == 403
    assert send(**{"Sec-Fetch-Site": "none"}).status_code == 403
    assert send(**{"Sec-Fetch-Site": "same-origin"}).status_code == 303


def test_the_origin_check_covers_every_state_change(client, sign_in):
    sign_in(client)
    bad = {"Origin": "https://evil.example"}
    assert client.post("/logout", headers=bad).status_code == 403
    assert client.put("/api/save/mahjong", headers=bad).status_code == 403
    assert is_alive(client)


def test_reads_need_no_origin(client, sign_in):
    sign_in(client)
    assert client.get(LIVE_PROBE, headers={"Origin": "https://evil.example"}).status_code == 404


# No password set


def test_login_with_no_password_set_always_fails(client, monkeypatch):
    real, seen = auth._verify, []

    def spy(stored, password):
        seen.append(stored)
        return real(stored, password)

    monkeypatch.setattr(auth, "_verify", spy)
    for attempt in [PASSWORD, "", WRONG]:
        r = post_login(client, attempt)
        assert r.status_code == 401 and auth.WRONG_MESSAGE in r.text
        assert set_cookies(r) == []
    # A real hash is checked, so timing does not reveal that none is set.
    assert all(s.startswith("$argon2id$") for s in seen) and len(seen) == 3


def test_a_corrupt_stored_hash_fails_closed(client, database):
    database.execute("INSERT INTO account (id, password_hash) VALUES (1, 'garbage')")
    assert post_login(client).status_code == 401


# Logout


def test_logout_ends_the_session(client, password_set, database):
    token = cookie_value(post_login(client))
    r = client.post("/logout", headers=ORIGIN, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/login"
    [cookie] = set_cookies(r)
    assert cookie.startswith(f"{COOKIE}=;") and "Max-Age=0" in cookie
    assert {"Secure", "HttpOnly", "SameSite=Strict", "Path=/"} <= {
        p.strip() for p in cookie.split(";")
    }
    assert rows(database, "session") == 0
    client.cookies.clear()
    client.cookies.set(COOKIE, token)  # the old cookie, replayed
    assert not is_alive(client)


def test_logout_due_for_renewal_is_not_undone_by_the_renewal(client, password_set, clock):
    post_login(client)
    clock.advance(DAY + 1)
    r = client.post("/logout", headers=ORIGIN, follow_redirects=False)
    [cookie] = set_cookies(r)
    assert "Max-Age=0" in cookie


def test_login_due_for_renewal_sets_one_cookie(client, password_set, clock):
    post_login(client)
    clock.advance(DAY + 1)
    assert len(set_cookies(post_login(client))) == 1


# The page


def test_no_rendered_public_file_mentions_game_code(client):
    served = [client.get("/login").text, client.get("/login.css").text]
    for text in served:
        lowered = text.lower()
        for word in ["<script", ".js", "mahjong", "sudoku", "tile_art", "/assets", "/api", "http://", "https://"]:
            assert word not in lowered, word
    assert sorted(p.name for p in auth.PUBLIC_DIR.iterdir() if p.is_file()) == [
        "login.css",
        "login.html",
    ]


def test_the_page_obeys_the_csp_and_shows_the_tiles(client):
    r = client.get("/login")
    html = r.text
    assert "<style" not in html and not re.search(r"\sstyle\s*=", html)
    assert not re.search(r"\son[a-z]+\s*=", html)
    assert html.count("<svg") == 5
    assert 'method="post"' in html and 'action="/login"' in html
    assert 'name="password"' in html and 'type="password"' in html
    assert r.headers["cache-control"] == "no-store"
    assert "<!--" not in html
