"""The real image, built and run the way the box runs it. Skipped without Docker."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
TAG = f"isoca-play:image-test-{uuid.uuid4().hex[:8]}"
VERSION = "image-test-commit"
PASSWORD = "a throwaway password for the image test"
RESIDENT_LIMIT_MB = 128
ROUNDS = 50
BODY = {"moves": list(range(4000))}  # about the size of a long game's save


def docker(*args: str, timeout: float = 60, stdin: str | None = None) -> subprocess.CompletedProcess:
    # Bytes in and out: text mode on Windows would add \r to what is typed, and read
    # build output in the local code page.
    done = subprocess.run(
        ["docker", *args],
        capture_output=True,
        timeout=timeout,
        input=None if stdin is None else stdin.encode(),
    )
    return subprocess.CompletedProcess(
        done.args, done.returncode, done.stdout.decode(errors="replace"), done.stderr.decode(errors="replace")
    )


def linux_daemon() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        answer = docker("version", "--format", "{{.Server.Os}}", timeout=20)
    except subprocess.TimeoutExpired:
        return False
    return answer.returncode == 0 and answer.stdout.strip() == "linux"


pytestmark = pytest.mark.skipif(not linux_daemon(), reason="no reachable Docker daemon for Linux")


@pytest.fixture(scope="module")
def image():
    built = docker("build", "--build-arg", f"VERSION={VERSION}", "-t", TAG, str(ROOT), timeout=900)
    if built.returncode != 0:
        pytest.fail(f"docker build failed:\n{built.stderr[-3000:]}")
    yield TAG
    docker("image", "rm", TAG)


@pytest.fixture(scope="module")
def container(image):
    """Read-only root, /tmp a tmpfs, nothing but /data to write to, as on the box."""
    started = docker(
        "run", "--detach", "--read-only", "--tmpfs", "/tmp",
        "--tmpfs", "/data:uid=10001,gid=10001,mode=0750",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "256m",
        "--publish", "127.0.0.1::8000", image,
    )  # fmt: skip
    assert started.returncode == 0, started.stderr
    name = started.stdout.strip()
    try:
        yield name
    finally:
        docker("rm", "--force", name)


@pytest.fixture(scope="module")
def http(container):
    published = docker("port", container, "8000/tcp").stdout.splitlines()[0].strip()
    with httpx.Client(base_url=f"http://{published}", timeout=30) as client:
        end = time.monotonic() + 30
        while True:
            try:
                client.get("/healthz")
                break
            except httpx.TransportError:
                if time.monotonic() > end:
                    logs = docker("logs", container)
                    pytest.fail(f"the server did not start:\n{logs.stdout}\n{logs.stderr}")
                time.sleep(0.25)
        yield client


def inside(container: str, code: str) -> str:
    """Run Python in the container; the answer is what it prints."""
    done = docker("exec", container, "python", "-c", code)
    assert done.returncode == 0, done.stderr
    return done.stdout.strip()


def status_kb(container: str, field: str) -> int:
    status = docker("exec", container, "cat", "/proc/1/status").stdout
    return int(re.search(rf"^{field}:\s+(\d+) kB", status, re.M).group(1))


def test_health_names_the_build(http):
    answer = http.get("/healthz")
    assert answer.status_code == 200
    assert answer.json() == {"version": VERSION}


def test_healthcheck_passes_without_curl(container, http):
    assert inside(container, "import shutil; print(shutil.which('curl'))") == "None"
    end = time.monotonic() + 60
    health = ""
    while time.monotonic() < end and health != "healthy":
        health = docker("inspect", "--format", "{{.State.Health.Status}}", container).stdout.strip()
        time.sleep(1)
    assert health == "healthy"


def test_runs_as_the_unprivileged_user(container, http):
    # PID 1 itself, and what an exec gets.
    status = docker("exec", container, "cat", "/proc/1/status").stdout
    assert re.search(r"^Uid:\s+10001\s", status, re.M)
    assert inside(container, "import os; print(os.getuid())") == "10001"


def test_root_is_read_only_and_tmp_is_not(container, http):
    assert docker("exec", container, "touch", "/app/x").returncode != 0
    assert docker("exec", container, "touch", "/opt/venv/x").returncode != 0
    assert docker("exec", container, "touch", "/tmp/x").returncode == 0


def test_server_header_is_off(http):
    assert "server" not in http.get("/healthz").headers


LEFT_OUT = """
import importlib.util, os
names = {'.git', 'rustoku', 'make_sudoku_pack.py', 'make_solitaire_pack.py', 'sudoku_grader.py', 'write_deal_samples.py',
         'deal-samples.json', 'rule-cases.json', 'tip-cases.json', 'make_tip_cases.py', 'conftest.py',
         'solitaire_rules.py', 'make_solitaire_cases.py', 'solitaire-cases.json',
         'Dockerfile', 'pyproject.toml', 'requirements.txt', 'package-lock.json', 'node_modules'}
found = []
for top, dirs, files in os.walk('/'):
    if top in ('/proc', '/sys', '/dev'):
        dirs[:] = []
        continue
    found += [os.path.join(top, n) for n in dirs + files
              if n in names or n.lower().startswith('rustoku')]
for gone in ('rustoku', 'pytest', 'httpx', 'setuptools', 'pip'):
    if importlib.util.find_spec(gone):
        found.append('module ' + gone)
for path in ('/app/tools', '/app/server', '/app/shared', '/app/web/src', '/shared', '/tools', '/src'):
    if os.path.exists(path):
        found.append(path)
print('\\n'.join(found))
"""


def test_only_the_package_and_the_build_are_there(container, http):
    assert inside(container, LEFT_OUT) == ""
    # Only the package's own files: no tests or dev tools came with it.
    listing = inside(
        container,
        "import isoca_play, os; p = os.path.dirname(isoca_play.__file__); "
        "print(sorted(n for n in os.listdir(p) if n != '__pycache__'))",
    )
    assert "tests" not in listing and "tools" not in listing
    assert "data" in listing and "public" in listing and "shared" in listing


@pytest.fixture(scope="module")
def account(container, http):
    """The password, set the way the owner sets it. With no terminal, getpass reads stdin."""
    return docker(
        "exec", "--interactive", container, "isoca-play", "set-password", stdin=f"{PASSWORD}\n{PASSWORD}\n"
    )


def test_set_password_is_on_the_path(account):
    assert account.returncode == 0, account.stderr
    assert "Password set" in account.stdout


def sign_in(http) -> dict[str, str]:
    """One real login. The cookie is __Host-, so it is carried by hand over plain http."""
    answer = http.post(
        "/login",
        content=f"password={PASSWORD.replace(' ', '+')}",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": f"https://{http.base_url.netloc.decode()}",
        },
    )
    assert answer.status_code == 303, answer.text
    cookie = answer.headers["set-cookie"].split(";", 1)[0]
    return {"Cookie": cookie, "Origin": f"https://{http.base_url.netloc.decode()}"}


def test_the_built_site_is_behind_the_login(account, http):
    assert http.get("/login").status_code == 200
    assert http.get("/").status_code == 302
    assert http.get("/sw.js").status_code == 302

    headers = sign_in(http)
    page = http.get("/", headers=headers)
    assert page.status_code == 200
    script = re.search(r'src="(/assets/[^"]+\.js)"', page.text)
    assert script, page.text
    assert http.get(script.group(1), headers=headers).status_code == 200
    worker = http.get("/sw.js", headers=headers)
    assert worker.status_code == 200
    assert "__SW_" not in worker.text


def test_resident_memory_after_logins_and_saves(account, container, http):
    body = json.dumps(BODY)
    for _ in range(ROUNDS):
        headers = sign_in(http)
        saved = http.put(
            "/api/save/sudoku",
            content=body,
            headers={**headers, "Content-Type": "application/json"},
        )
        assert saved.status_code == 204, saved.text
        assert http.get("/api/save/sudoku", headers=headers).text == body

    resident = status_kb(container, "VmRSS") / 1024
    peak = status_kb(container, "VmHWM") / 1024
    print(f"resident {resident:.1f} MB, peak {peak:.1f} MB after {ROUNDS} logins and saves")
    assert resident < RESIDENT_LIMIT_MB
