# First Playtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The game running at `play.isoca.space` behind a password, resuming on any device and playable offline, ready for the owner to playtest on their phone.

**Architecture:** One small Python service serves the built frontend behind a session check, stores saves in SQLite, and hands out new games. Game rules stay in TypeScript on the device, and a service worker keeps the app playable offline. GitHub Actions publishes an image and names its digest over a release-only SSH key; a root systemd unit on the box applies it.

**Tech Stack:** Python 3.12, FastAPI, one uvicorn worker, stdlib `sqlite3`, `argon2-cffi`, pytest. Existing Vite, React, TypeScript and Vitest frontend. Docker Compose, Traefik, systemd, Bash. `rustoku` at development time only.

**Spec:** `docs/superpowers/specs/2026-10-31-isoca-play-design.md`

Two repos: `isoca-play` (this one, branch `design-check`) and `isoca-infra` (new branch `play`, cloned beside this repo).

## Global Constraints

- The owner does every git push, PR merge and root step. Commit locally only. Commits carry no Claude co-author trailer.
- Both repos are public. No IP, SSH port, user name, secret, save or screenshot of someone else's game in either.
- One account, password only, no sign-up. At least 12 characters. Argon2id.
- Session: about 30 days, renewed on use, 256-bit random token stored hashed. Cookie `__Host-session`: `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`.
- Block an IP for 15 minutes after 5 failures, plus a site-wide slowdown under wider attack. An existing session keeps working during a block.
- Without a session, every path answers the login page, or 401 under `/api`. Only these are public: `/login`, `/login.css`, `/fonts/*`, `/healthz`. The login page may show tile art (owner); none of these holds game code.
- Offline: play yes; saving, new games and logging in no. Logging out clears the device's copy.
- Sudoku shows no mistake signal before the board is full.
- No request to a third party.
- Container: read-only root, all capabilities dropped, `no-new-privileges`, 256 MB, one writable bind mount `/srv/play/data`, no published ports.
- Database changes are additive, so a rollback stays safe.

## Plan decisions, within the spec's room

- **Sudoku pack:** the spec allows a pack or server generation. A committed pack of 300 puzzles per level means `rustoku` never enters the image, and new games are instant.
- **The single-file build goes.** Its inline script and styles conflict with the strict CSP, and its reason, the artifact, is gone: the owner passed the design check locally.
- **Public login assets:** the login page needs its own stylesheet and fonts before a session exists. They carry no game code. The owner wants the cute tiles on the login page, so it shows a few as inline SVG with no extra public path and no script.

## Review Focus

- A session expiring while the page is open must not lose moves: the marker shows, saves wait, and logging in again in another tab lets the next retry succeed. Pinned in Task 6.
- Two devices: the last save wins, and a device opening later shows the latest save rather than overwriting it with an empty game. Pinned in Task 6.
- A new release must not leave a phone stuck on an old cached app forever: the worker updates on the next online load. Pinned in Task 7.
- Traefik restarted or a bad image: the old container keeps serving unless the new one is healthy, or the apply reports failure and rollback restores it. Pinned in Task 9.
- A spoofed `X-Forwarded-For` must not dodge the login block: only the entry Traefik appended counts. Pinned in Task 2.

---

### Task 1: Service, database and the password command

**Files:**
- Create: `server/pyproject.toml`, `server/requirements.txt` (hash-pinned), `server/isoca_play/__init__.py`, `app.py`, `db.py`, `cli.py`, `config.py`
- Test: `server/tests/test_db.py`, `server/tests/test_cli.py`, `server/tests/test_health.py`

**Interfaces:**
- Produces: `create_app(settings: Settings) -> FastAPI`; `Settings(db_path: Path, static_dir: Path, version: str, now: Callable[[], float])`; `connect(path) -> sqlite3.Connection` (WAL, foreign keys on, applies numbered additive migrations); tables `account(id=1, password_hash)`, `session(token_hash, expires_at)`, `failure(ip, at)`, `save(game, body, updated_at)`; CLI `isoca-play set-password`, which prompts twice with `getpass`.

- [ ] **Step 1: Write the failing tests**

```python
def test_set_password_stores_argon2_and_ends_sessions(tmp_path, monkeypatch): ...
    # hash starts with "$argon2id$"; the session table is empty afterwards
def test_set_password_refuses_under_12_characters(...): ...  # exit code 1, nothing stored
def test_set_password_refuses_a_mismatch(...): ...
def test_migrations_are_repeatable(tmp_path): ...  # connect twice, no error
def test_healthz_is_public_and_names_the_version(client):
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json() == {"version": "test"}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && python -m pytest -q`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Python 3.10 is what's on the PC, so stay compatible with 3.10 and 3.12.

- [ ] **Step 4: Run them to verify they pass.** Expected: PASS.

- [ ] **Step 5: Commit:** `server: the service, its database and the password command`

### Task 2: Login, sessions and the guard

**Files:**
- Create: `server/isoca_play/auth.py`, `server/isoca_play/public/login.html`, `login.css`, `fonts/` (the latin woff2 of VT323 and Press Start 2P, copied from `@fontsource`)
- Modify: `server/isoca_play/app.py`
- Test: `server/tests/test_auth.py`

**Interfaces:**
- Consumes: Task 1.
- Produces: `POST /login` (form field `password`), `POST /logout`, middleware `require_session`; `client_ip(request) -> str`, the rightmost `X-Forwarded-For` entry.

- [ ] **Step 1: Write the failing tests**

```python
def test_no_session_gets_the_login_page_everywhere(client):
    for path in ["/", "/assets/x.js", "/sw.js"]:
        r = client.get(path, follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"] == "/login"
    assert client.get("/api/save/mahjong").status_code == 401
def test_right_password_sets_the_cookie(client):
    # __Host-session with Secure, HttpOnly, SameSite=Strict, Path=/, Max-Age about 30 days
def test_the_token_is_stored_hashed(client, db): ...
def test_session_renews_on_use_and_expires_after_30_days(client, clock): ...
def test_five_failures_block_the_ip_for_15_minutes(client, clock): ...
    # even the right password fails while blocked; it works after 15 minutes
def test_spoofed_forwarded_for_does_not_dodge_the_block(client):
    # vary the leftmost X-Forwarded-For entry, keep the last: still blocked
def test_wide_attack_slows_logins_but_a_session_still_works(client, clock): ...
def test_login_refuses_a_foreign_origin(client): ...
def test_login_with_no_password_set_always_fails(client): ...
def test_logout_ends_the_session(client): ...
def test_no_rendered_public_file_mentions_game_code(client): ...
```

- [ ] **Step 2: Run them to verify they fail.** Run: `cd server && python -m pytest -q tests/test_auth.py`. Expected: FAIL.

- [ ] **Step 3: Implement.** Argon2 verify runs in a worker thread with a semaphore of 1, so a flood can't exhaust the 256 MB cap. Site-wide slowdown: above 20 failures an hour, process one login attempt per 5 seconds. Failures are stored, so a restart doesn't clear a block. The page uses the theme's colours, shows a few tiles from the approved set as inline SVG at whole-number scale, and is a plain form with no script.

- [ ] **Step 4: Run them to verify they pass.** Expected: PASS.

- [ ] **Step 5: Commit:** `server: password login, sessions and the guard`

### Task 3: Saves

**Files:**
- Create: `server/isoca_play/saves.py`
- Test: `server/tests/test_saves.py`

**Interfaces:**
- Produces: `GET /api/save/{game}` (`game` is `mahjong` or `sudoku`) returns the JSON body or 204; `PUT /api/save/{game}` stores an opaque JSON object, returns 204; `DELETE` is not needed, as a new game overwrites.

- [ ] **Step 1: Write the failing tests**

```python
def test_save_round_trip(client_logged_in): ...
def test_last_save_wins(client_logged_in): ...
def test_body_over_512_kib_is_refused_with_413(client_logged_in): ...
def test_invalid_json_or_a_non_object_is_refused_with_400(client_logged_in): ...
def test_unknown_game_is_404(client_logged_in): ...
def test_foreign_origin_put_is_refused(client_logged_in): ...
```

- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Check the size from the stream, not only from `Content-Length`.
- [ ] **Step 4: Run them to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit:** `server: one saved game of each kind`

### Task 4: Mahjong deals move to the server

**Files:**
- Create: `shared/layouts.json`, `shared/faces.json`, `shared/rule-cases.json`, `shared/deal-samples.json`, `server/isoca_play/mahjong.py`, `web/src/mahjong/shared.test.ts`
- Modify: `web/src/mahjong/layouts.ts` (reads the JSON), `web/src/mahjong/rules.ts`
- Delete: `web/src/mahjong/deal.ts`, moving its still-relevant tests
- Test: `server/tests/test_mahjong.py`

**Interfaces:**
- Produces: `POST /api/new/mahjong` with `{"layout": "fort"}` returns `{"layout", "tiles": [{id, x, y, z, face}]}`; `make_deal(layout, seed) -> list[Tile]`, `match_key(face)`, `is_free(...)` in Python.

Layouts and faces move to JSON because both languages need them. `rule-cases.json` lists board positions with the expected covered, free and `matchKey` answers, and both suites run it. `deal-samples.json` is written by a small script from Python deals and committed; the TypeScript suite plays every sample through the real `tap` and asserts it can be won.

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.parametrize("layout", LAYOUTS)
def test_every_deal_is_winnable_with_real_rules(layout):
    for seed in range(1, 201):
        assert can_win(make_deal(layout, seed))
def test_a_season_or_flower_pair_uses_two_different_faces(): ...
def test_shared_rule_cases_hold(): ...
def test_same_seed_same_deal(): ...
def test_unknown_layout_is_404(client_logged_in): ...
def test_it_needs_a_session(client): ...
```

```ts
test.each(samples)('$layout sample $seed plays to a win through tap', (s) => {
  expect(canWin(s.tiles)).toBe(true);
});
test.each(ruleCases)('$name matches the shared answer', (c) => { /* isCovered, isFree, matchKey */ });
```

- [ ] **Step 2: Run both suites to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Port `makeDeal`'s approach as it stands. Add a cap on restarts that raises rather than looping forever. Generate the samples: 20 per layout.
- [ ] **Step 4: Run both suites to verify they pass.** Run: `cd server && python -m pytest -q` and `npm test --prefix web`. Expected: PASS.
- [ ] **Step 5: Commit:** `mahjong: deals come from the server, with shared layouts and rule cases`

### Task 5: Graded sudoku pack

**Files:**
- Create: `tools/make_sudoku_pack.py`, `tools/requirements.txt`, `server/isoca_play/data/sudoku_pack.json`, `server/isoca_play/sudoku.py`
- Test: `server/tests/test_sudoku.py`

**Interfaces:**
- Produces: `POST /api/new/sudoku` with `{"level": "hard", "not": "<givens>"}` returns `{"level", "givens", "solution"}`.

Grading per the spec: easy needs singles only; medium also needs locked candidates or pairs; hard also needs triples, X-wing or similar. Everything must solve by those techniques alone.

- [ ] **Step 1: Check `rustoku`.** In a scratch venv, install `rustoku==0.16.0` and read `docs/python.md`. Decide: if its solve path names the technique of each step, grade with it. Otherwise write a small human-technique solver in `tools/` (MIT `GillesArcas/sudosol` is a reference). Record the choice in the report.
- [ ] **Step 2: Write the failing tests**

```python
def test_pack_has_300_per_level(): ...
@pytest.mark.parametrize("p", PACK_SAMPLE)
def test_puzzle_has_one_solution_and_matches(p): ...  # independent backtracking counter in the test
def test_harder_levels_give_fewer_numbers_on_average(): ...
def test_new_game_differs_from_the_not_field(client_logged_in): ...
def test_it_needs_a_session(client): ...
```
- [ ] **Step 3: Run them to verify they fail.** Expected: FAIL.
- [ ] **Step 4: Generate the pack and implement.** The test suite must also grade a sample of 30 per level with the tool's grader when it is installed, and skip that test otherwise. Credit the library in the README if it's used.
- [ ] **Step 5: Run them to verify they pass.** Expected: PASS.
- [ ] **Step 6: Commit:** `sudoku: a graded pack, and new games from the server`

### Task 6: The app talks to the server

**Files:**
- Create: `web/src/api.ts`, `web/src/useSavedGame.ts`, `web/src/SaveMarker.tsx`
- Modify: `web/src/App.tsx`, `web/src/Home.tsx`, `web/src/mahjong/MahjongGame.tsx`, `web/src/sudoku/SudokuGame.tsx`, `web/src/sudoku/puzzles.ts` (removed), `web/vite.config.ts`, `web/src/build.test.ts`, `web/src/fonts.css`
- Test: `web/src/useSavedGame.test.tsx`, `web/src/App.test.tsx`

**Interfaces:**
- Produces: `loadSave(game)`, `putSave(game, body)`, `newMahjong(layoutId)`, `newSudoku(level, not)`; `useSavedGame(game)` returning `{ state, setState, saving: 'saved' | 'retrying' | 'offline' }`, retrying with backoff up to 30 s and sending only the latest state.

- [ ] **Step 1: Write the failing tests**

```ts
test('opening the app resumes the saved games', async () => {});
test('every move saves when online', async () => {});
test('a failed save shows the marker, retries, and stores only the latest state', async () => {});
test('a 401 shows the marker and a link to log in, and keeps the game in memory', async () => {});
test('a device opening later shows the latest save', async () => {});
test('a save never overwrites a game that has not finished loading', async () => {});
test('new game is disabled offline with a short note', async () => {});
test('home has a log out button that posts /logout', async () => {});
```

- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the single-file build with a normal Vite build into `web/dist` with hashed assets. Rewrite `build.test.ts` to assert no inline script or style, no third-party URL, and that only latin font files ship. While here, fix the deferred minors: stale fixture faces in `MahjongGame.test.tsx`, readable accessible names ("Moon", "Panda", "Circle 3"), the stale comment in `theme.css`.
- [ ] **Step 4: Run them to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit:** `web: saves and new games through the server, and log out`

### Task 7: Offline

**Files:**
- Create: `web/public/sw.js`, `web/src/offline.ts`
- Modify: `server/isoca_play/app.py`, `web/src/main.tsx`, `web/src/useSavedGame.ts`
- Test: `web/src/offline.test.ts`, `server/tests/test_static.py`, and a real-browser script in `web/e2e/offline.mjs`

**Interfaces:**
- Produces: `sw.js` precaches the app shell and hashed assets from a build-generated list. Navigations are network-first, falling back to the cached shell. A redirect to `/login` passes through when online. `GET /api/save/*` is network-first, falling back to the last successful save. `clearDevice()` removes every cache and unregisters the worker.

- [ ] **Step 1: Write the failing tests:** the app's offline table from the spec, through a real browser against the real server:

```text
load once, go offline, reload: the game resumes from the last save and plays
offline with the page open: moves work and the marker shows
back online with the page open: the latest state reaches the server
new game offline: disabled; log in offline: not offered
log out: caches are gone and no game code is served offline
a new release: the next online load runs the new version
```

Also pin in pytest: `/sw.js` needs a session; hashed assets get `Cache-Control: immutable`, while `/`, `/sw.js` get `no-cache`.

- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the worker small and hand-written.
- [ ] **Step 4: Run them to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit:** `web: playable offline once loaded`

### Task 8: Image and release workflow

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `README.md`, `.gitattributes`

**Interfaces:**
- Produces: image `ghcr.io/isabellybaldo/isoca-play`, running as uid 10001 with `DB_PATH=/data/play.db`; `VERSION` baked from the commit. `release.yml` on main: tests, gitleaks, build and push, `ssh deploy@host "release play sha256:<digest>"`, then a smoke check that `/login` answers 200 and `/healthz` names this commit. A `workflow_dispatch` input runs `rollback play`.

Follow `isoca-infra/.github/workflows/deploy-static.yml`: every action pinned by SHA, secrets in the `production` environment, the same empty-secret check, the key removed in an `always()` step, a job gate on `refs/heads/main`.

- [ ] **Step 1: Write the check:** `server/tests/test_image.py`, skipped without Docker, builds the image and asserts: runs as non-root, starts with a read-only root and a `/tmp` tmpfs, `/healthz` answers, no `rustoku`, no `tools/`, no `.git`, and resident memory under 128 MB after 50 logins and saves.
- [ ] **Step 2: Run it to verify it fails.** Expected: FAIL, no Dockerfile.
- [ ] **Step 3: Write the Dockerfile and workflows.** Multi-stage, base images pinned by digest.
- [ ] **Step 4: Run it to verify it passes,** if Docker is available here; otherwise say so plainly in the report and let CI be the first run.
- [ ] **Step 5: Commit:** `ci: test, publish the image and release it by digest`

### Task 9: The box side, in isoca-infra

Work on a new branch `play` in `isoca-infra`.

**Files:**
- Modify: `box/site-deploy`, `tests/site-deploy.test.sh`, `tests/edge.test.sh`, `tests/workflows.test.sh`, `.github/workflows/ci.yml`, `README.md`
- Create: `edge/dynamic/play.yml`, `play/compose.yml`, `box/play-apply`, `box/play-apply.path`, `box/play-apply.service`, `tests/play-apply.test.sh`

**Interfaces:**
- `site-deploy --only-play` (from the new key's forced command) allows only `release play sha256:<64 hex>` and `rollback play`. Every other command is refused with exit 2. Without the flag, today's behaviour is unchanged; those two verbs are refused for the old key, keeping the service's key the only way in.
- `release` atomically writes `/srv/play/state/desired-image`. `rollback` copies `previous-image` over it.
- `play-apply`, run by root from the path unit: validates the digest again against a fixed image name, pulls, recreates through `docker compose --env-file`, waits up to 60 s for healthy. On failure it restores the old digest and recreates. It writes `applied-image`, `previous-image` and a one-line `last-result`.

- [ ] **Step 1: Write the failing tests**

```bash
# site-deploy.test.sh
only-play key: release with a good digest -> writes desired-image, exit 0
only-play key: deploy radar / edge-config / rollback radar -> refused, exit 2
only-play key: digest with a shell character, too short, or another image -> refused, nothing written
old key: release play -> refused
# play-apply.test.sh, with a fake docker on PATH
good digest: pull, up, healthy -> applied-image updated, previous-image holds the old one
unhealthy: the old digest is restored and last-result says failed
a hostile desired-image -> nothing runs
# edge.test.sh
play router: host play.isoca.space, websecure, sec, rl, inflight and csp-play on it
csp-play has connect-src 'self', form-action 'self', worker-src 'self', font-src 'self', and no 'unsafe-inline'
```

- [ ] **Step 2: Run them to verify they fail.** Run the scripts in `tests/` with Git Bash. Expected: FAIL.
- [ ] **Step 3: Implement.** `play/compose.yml` joins the external `edge_edge` network with the Global Constraints' hardening; its internal network means the container has no internet, which it doesn't need. The Traefik service is `http://play:8000`.
- [ ] **Step 4: Run all tests in `tests/` to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit:** `play: the route, the service and a release-only key`

### Task 10: Owner's runbook

**Files:**
- Create: `isoca-infra/runbooks/03-play.md`

The owner's runbook format: each step is command, then expected, then what to do if not. Self-contained, no prose, STOP where a failure could lock them out. Marks every push and root step as the owner's, and uses `local.env` for private values.

Order: gitleaks both repos; create the public `isoca-play` repo and push; DNS record for `play.isoca.space`, checking it resolves; new key pair; `authorized_keys` line with `--only-play` and `restrict`; GitHub `production` environment and secrets in `isoca-play`; directories (`/srv/play/data` uid 10001 mode 700, `/srv/play/state` owned by deploy); install `site-deploy`, `play-apply` and the units; merge `play` in `isoca-infra`, which ships the route; push `isoca-play` to main, which releases; make the GHCR package public; `set-password`; rollback drill; then checks on the real site: nothing but the login page without a session, the block after 5 failures, the cookie flags, `curl` of `/assets` and `/sw.js` redirected, offline on the phone.

- [ ] **Step 1: Write it,** checking each command against the files of Tasks 8 and 9.
- [ ] **Step 2: Extend `tests/no-secrets.sh` coverage if needed and run it.** Expected: PASS.
- [ ] **Step 3: Commit:** `runbook 3: play.isoca.space`

The work stops here for the owner's runbook, then the phone playtest. Tuning and the remaining shapes get their own plan from what the owner reports.
