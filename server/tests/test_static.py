"""The built frontend, behind the session guard."""

import httpx
import pytest

BASE_URL = "https://testserver"
INDEX = "<!doctype html><title>the app</title>"
SCRIPT = "console.log('game code')"
SECRET = "outside the static dir"


@pytest.fixture
def built(settings, tmp_path):
    """A web/dist, with a file just outside it that must never be served."""
    assets = settings.static_dir / "assets"
    assets.mkdir(parents=True)
    (settings.static_dir / "index.html").write_text(INDEX, encoding="utf-8")
    (assets / "app-abc123.js").write_text(SCRIPT, encoding="utf-8")
    (tmp_path / "secret.txt").write_text(SECRET, encoding="utf-8")
    return settings.static_dir


@pytest.fixture
def signed_in(client, sign_in, built):
    sign_in(client)
    return client


def raw_get(client, raw: bytes):
    return client.get(httpx.URL(BASE_URL).copy_with(raw_path=raw), follow_redirects=False)


# Every way we know to spell a path out of the assets folder or the static dir.
ESCAPES = [
    b"/assets/../secret.txt",
    b"/assets/../../secret.txt",
    b"/../secret.txt",
    b"/assets/%2e%2e/%2e%2e/secret.txt",
    b"/assets/..%2f..%2fsecret.txt",
    b"/assets/%2e%2e%2f%2e%2e%2fsecret.txt",
    b"/assets/..%5c..%5csecret.txt",
    b"/assets/%252e%252e/%252e%252e/secret.txt",
    b"/%2e%2e/secret.txt",
    b"/..%2fsecret.txt",
    b"/assets/....//....//secret.txt",
]


def test_signed_in_gets_the_app_at_the_root(signed_in):
    r = signed_in.get("/")
    assert r.status_code == 200
    assert r.text == INDEX
    assert r.headers["content-type"].startswith("text/html")


def test_signed_in_gets_the_assets(signed_in):
    r = signed_in.get("/assets/app-abc123.js")
    assert r.status_code == 200 and r.text == SCRIPT
    assert "javascript" in r.headers["content-type"]


def test_an_unknown_path_is_a_404(signed_in):
    assert signed_in.get("/assets/nope.js").status_code == 404
    assert signed_in.get("/nope").status_code == 404


def test_the_routes_still_answer_in_front_of_the_mount(signed_in):
    assert signed_in.get("/healthz").json() == {"version": "test"}
    assert signed_in.get("/api/save/mahjong").status_code == 204
    assert signed_in.get("/login.css").status_code == 200
    assert signed_in.get("/api/nope").status_code == 404


def test_no_session_gets_none_of_it(client, built):
    for path in ["/", "/index.html", "/assets/app-abc123.js"]:
        r = client.get(path, follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"] == "/login"
        assert SCRIPT not in r.text and INDEX not in r.text


@pytest.mark.parametrize("raw", ESCAPES)
def test_no_session_dotted_paths_go_to_login(client, built, raw):
    r = raw_get(client, raw)
    assert r.status_code == 302 and r.headers["location"] == "/login"


@pytest.mark.parametrize(
    "raw",
    [
        b"/fonts/../assets/app-abc123.js",
        b"/fonts/..%2fassets/app-abc123.js",
        b"/fonts/%2e%2e/assets/app-abc123.js",
        b"/login/../assets/app-abc123.js",
        b"/login.css/../index.html",
        b"/healthz/..%2findex.html",
    ],
)
def test_no_session_cannot_reach_the_app_through_a_public_path(client, built, raw):
    r = raw_get(client, raw)
    assert r.status_code == 302 and r.headers["location"] == "/login"
    assert SCRIPT not in r.text and INDEX not in r.text


@pytest.mark.parametrize("raw", ESCAPES)
def test_signed_in_dotted_paths_never_leave_the_static_dir(signed_in, raw):
    r = raw_get(signed_in, raw)
    assert SECRET not in r.text
    assert r.status_code == 404


def test_signed_in_the_database_beside_the_static_dir_stays_out_of_reach(signed_in, settings):
    # The test database lives one level above the static dir.
    assert settings.db_path.exists()
    for raw in [b"/../play.db", b"/assets/..%2f..%2fplay.db", b"/%2e%2e/play.db"]:
        assert raw_get(signed_in, raw).status_code == 404


def test_a_missing_build_is_a_404_not_a_crash(client, sign_in):
    sign_in(client)
    assert client.get("/").status_code == 404
    assert client.get("/assets/x.js").status_code == 404
    assert client.get("/healthz").status_code == 200


# State changes on the static paths: the guard answers first, then the mount refuses.

FOREIGN = {"Origin": "https://evil.example"}
OWN = {"Origin": BASE_URL}
STATE_CHANGES = [(m, p) for m in ("PUT", "POST") for p in ("/assets/x", "/")]


@pytest.mark.parametrize("method, path", STATE_CHANGES)
def test_a_foreign_origin_is_refused_signed_in_or_out(client, sign_in, built, method, path):
    assert client.request(method, path, headers=FOREIGN).status_code == 403
    sign_in(client)
    assert client.request(method, path, headers=FOREIGN).status_code == 403


@pytest.mark.parametrize("method, path", STATE_CHANGES)
def test_signed_in_with_our_origin_the_mount_takes_no_writes(signed_in, method, path):
    assert signed_in.request(method, path, headers=OWN).status_code == 405


@pytest.mark.parametrize("method, path", STATE_CHANGES)
def test_signed_out_with_our_origin_goes_to_login(client, built, method, path):
    r = client.request(method, path, headers=OWN, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/login"


@pytest.mark.parametrize("method", ["PUT", "POST"])
def test_signed_out_under_api_is_a_401(client, method):
    assert client.request(method, "/api/x", headers=OWN).status_code == 401
