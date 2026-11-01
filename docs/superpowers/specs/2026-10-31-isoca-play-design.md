# isoca-play: private sudoku and mahjong

Date: 2026-10-31. Status: approved by the owner 2026-10-31.

Items marked **(owner)** were said or confirmed by the owner. Items marked
**(call)** were decided by the designer and can be overruled. The drawings are
part of this design: `mahjong-schematics.md` and `sudoku-schematics.md`, to be
committed under `docs/` beside this file.

## Intent

The owner plays sudoku and mahjong solitaire a lot on their phone, and wants their
own versions, with their own rules and look, on the KVM2 they already run. It is
for one person. The login exists to keep strangers out, not to serve users.
**(owner)**

Success: the owner opens it on their phone, is already logged in, carries on the
game they left, and prefers it to the app they use today.

## Goals

- A mahjong page and a sudoku page, built for a phone and usable on a computer.
- A password login in front of the whole site.
- Each game resumes exactly where it was left, on any device.
- Open source code.
- A game can be played offline once it has been loaded. **(owner)**
- The pixel look of the owner's existing sites.

## Non-goals

- Other users, sign-up, email, password reset by email.
- Stats, history, streaks, leaderboards, sound.
- More than one game in progress per game type.
- An installable app. Offline play is a goal, through the browser.
- Saving progress or starting new games while offline. **(owner)**
- Backups of saves. A lost game is not a real loss. **(call)**

## Anti-goals

These would make it a failure even if everything else worked.

- Sudoku tells the player they are wrong before the board is full. **(owner)**
- A stray tap costs a mahjong slot. **(owner)**
- A secret or a save ends up in the repo.
- A stranger can see anything past the login page.
- Ads, trackers, or requests to third parties. **(call for third parties)**

## Mahjong

**Setup (owner).** A type is a specific setup, meaning the shape the tiles are stacked
in, and it belongs to one difficulty. The player picks a difficulty, then a type from
that difficulty's list, or presses random to get one from that list. **(call for the
order and what random covers)**

**Tiles (owner).** Cute pixel tiles, in the owner's pixel theme, all original. A tile
is one 18 x 23 sprite: a dark outline with cut corners, an ivory face and a rose edge.
It is only ever shown at a whole-number scale, 36 x 46 or 54 x 69 px, because a
fractional scale distorts the art. 54 is used only when the whole board fits the
viewport across and down. The back is rose with a salmon heart.

The set has 42 faces:

- Circles 1-9: the 1 is a plain red disc, the rest solid pips in red, blue and green.
- Bamboo 1-9: the 1 is a panda.
- Stars 1-9: the 1 is a moon, the rest violet twinkles.
- Critters: cat, bunny, frog, fish.
- Sweets: cherry, cupcake, heart.
- Seasons: spring, summer, autumn, winter.
- Flowers: plum, orchid, chrysanthemum, rose.

**Matching (owner).** Any season matches any season, and any flower matches any
flower. Everything else matches only itself. That makes 36 match kinds. A deal uses a
random subset when a shape has fewer pairs than that, and a season or flower pair is
two different faces from its group.

**Hidden tiles (owner confirmed).** A tile with another tile on top of it is face
down and cannot be clicked. It turns face up once nothing is on top of it. Upper tiles
sit half a tile off the layer below, never exactly on top, so the rose backs of the
tiles under them show.

**Free tiles (call).** A face-up tile can be clicked only if its left or right
side is open, the classic mahjong solitaire rule. Face-up tiles that are blocked at
both sides look dimmed.

**Moves (owner).** Two clicks send a tile up: the first selects it, the second sends
it to the next empty slot. A fast double-click counts as two clicks. Clicking a
different tile after the first click moves the selection to it. Clicking elsewhere
clears it. **(call for the last sentence)**

**Slots (owner).** There are 4 slots. A pair in the slots leaves right away, so up
to 3 unmatched tiles can be held. If the 4th tile makes no pair, the game is lost.
An empty board wins.

**Return (owner).** Takes back one send, including the send that lost the game. It
has no limit and works all the way back to the start of the game. **(owner confirmed)**

**Difficulty (owner).** Harder games have tiles that are harder to reach and make it
much easier to get stuck.

- Three levels: easy, medium, hard. **(owner confirmed)**
- Each shape is designed for its own level, not repeated across levels. **(owner)**
  This replaces the earlier idea of one layout per level for every shape. Harder
  shapes are taller and more tightly stacked, with fewer tiles free at any moment.
  **(call)**
- Every deal can be won, under the 4-slot rule. **(owner confirmed)** Generate each
  deal by simulating a full winning play backwards, not by shuffling and hoping.
- Hard deals should have few safe moves and force the player to hold tiles. The
  builder chooses how to measure this and tunes it by playing.

**No other rule settings (owner).** "Just choosing the type with a difficulty" is the
whole setup. The slot count and other rules are fixed, so the engine and generator
need no rule parameters.

**Layouts (call).** One original shape per level for now: frame, trophy and fort,
inspired by the owner's reference picture but not copied from it. The picture shows one difficulty's
list: named silhouettes such as a frame, a jester, overlapping blocks, a trophy, a
nautilus spiral and an advanced fort. It looks like Microsoft Mahjong, which groups
its boards the same way. The picture is a
screenshot of someone else's game, so it stays out of the public repo.
Every shape must fit a portrait phone with tiles
large enough to tap reliably: at most 8 tiles wide and 9 rows tall, so that at
320 x 568 a 36 px tile leaves Return on screen. Depth does more of the work than on
desktop versions. A column is one tile wide and a row is 40/46 of a tile tall, so a
tile's rose edge tucks under the row below. Adding a shape should mean adding data only.

## Sudoku

**Controls (owner).** A return button, notes on each square, and a separate way to
write the real number.

- A write/notes switch above a 1-9 pad. **(owner confirmed)**
- In notes mode, tapping a number toggles it in that square. **(owner confirmed)**
- Writing a number replaces that square's notes. **(owner confirmed)**
- Return undoes one change, of either kind, with no limit. **(owner confirmed)**

**No warnings (owner).** No red numbers, no mistake count, no hints, no timer. (Tips on request were added later, see
`2026-11-01-tips-maps-no-slots-design.md`; nothing is ever shown unasked.) To
keep that honest **(call)**: notes are never erased automatically, and same-number
highlighting is left out, since either would expose conflicts. Only the selected
square is highlighted.

**End (owner confirmed).** When the board is full it reports won or not solved,
without saying where. The player can then return and keep trying, or start over.

**Difficulty (owner).** Set by which sudoku rules the board needs, with fewer given
numbers on harder boards. Three levels **(call)**:

- Easy: singles only.
- Medium: also needs locked candidates or pairs.
- Hard: also needs triples, X-wing or similar.

Every puzzle has exactly one solution and can be solved by logic alone **(owner
confirmed)**. Grade puzzles with a solver that applies these rules in order. A
pre-generated pack or generation on the server are both fine, as long as starting a
game feels instant on a phone.

## Login and saves

- One account. No sign-up page. **(owner confirmed)**
- Password, not GitHub. **(owner)**
- Without a session, every path answers with the login page, or 401 for the API.
  That includes all scripts and game code. The login page itself may show tile art. **(owner)**
- The phone stays signed in for about 30 days, renewed on use. **(owner confirmed)**
  A log out button sits on the home page. **(call)**
- Password is set on the box with one command run by the owner, which also ends all
  sessions. The same command is the "forgot my password" path. **(owner confirmed)**
  It refuses fewer than 12 characters. **(call)**
- Repeated wrong passwords are slowed and then blocked. **(owner confirmed)** Block
  by IP after 5 failures for 15 minutes, plus a site-wide slowdown under a wider
  attack. An existing session keeps working during a block, so an attacker cannot
  lock the owner out of a game in progress. **(call)**
- One mahjong and one sudoku save, including the undo history. Starting a new game
  asks for one confirming tap, then replaces the old one. **(owner confirmed; call
  for the tap)**
- Every move saves when online. If a save fails, a small marker shows and the game
  retries. With two devices, the last save wins. **(call)**

## Offline

After a game has been loaded once, it stays playable with no connection. Saving
progress and loading new games do not work offline. **(owner)**

The rest is **(call)**:

```
                 online    offline, page open    offline, page reopened
play the game      yes            yes              yes, from last save
save progress      yes            no               no
new game           yes            no               no
log in             yes            no               no
```

- A service worker, registered after login, keeps the app, the tiles and the last
  save of each game on the device. Logging out clears them.
- All rules, including the sudoku end check and return, run on the device. The
  current puzzle or deal and its solution are part of the save.
- New games come from the server, so the new game button is disabled offline with a
  short note. This settles generation: it runs on the server or uses a pack served
  by it, not on the phone.
- A small marker shows that progress is not being saved. If the page stays open, the
  normal save retry stores the latest state when the connection returns. If the page
  is closed while offline, moves since the last save are lost.
- A session that expires while offline does not interrupt play. Saving waits until
  the owner logs in again.

## How it gets made (all call, except where marked)

**Repo.** New public repo `isabellybaldo/isoca-play`, MIT license. Independent of
`cute-trading`, which stays frozen.

**Open source (owner).** Code and tile art are public. The password hash, session
data and saves live only on the box, deploy secrets only in GitHub. gitleaks runs in
CI, the same way as `isoca-infra`.

**Address.** `play.isoca.space`. The owner adds the DNS record at Hostinger.

**Shape.** One small Python service **(owner)** that serves the built frontend behind
the session check and uses SQLite for storage. No nginx, no separate login proxy.
Python is fast enough: the server only handles a login, small saves and handing out
new games, and game rules run on the phone.

- Backend: FastAPI with one `uvicorn` worker, the standard `sqlite3` module,
  `argon2-cffi` for the password. Dependencies pinned with hashes.
- Generators: in Python on the server. If generating a hard game is too slow to feel
  instant, serve it from a pack filled ahead of time, not by adding a faster language.
- WebAssembly: not used at first. The owner is open to it, but nothing here needs it:
  the phone's rules are simple enough for TypeScript, and generation runs on the
  server, where WebAssembly would not help. Revisit only if a real slowdown appears
  on the phone. If it comes, Rust is the owner's accepted route: `cute-trading`
  already has a Rust part.
- The generators and the phone both need the rules, in two languages. Shared test
  cases, run against both, keep them from drifting apart.
- Frontend: Vite, TypeScript, React, as in `cute-trading/web`. Game rules live in
  plain TypeScript modules with no UI, so they can be tested alone.
- Theme: copy the colours and fonts from `cute-trading/web/src/theme.css`.
  Self-host the fonts. They come from Google there, which would be a third-party
  request here.
- Save API: stores the game state as an opaque JSON blob per game type, with a size
  limit. The rules run in the browser, which is fine with one trusted player.

**Security.**

- Session token: random, stored hashed. Cookie is `Secure`, `HttpOnly`,
  `SameSite=Strict`. State-changing requests also check `Origin`.
- Client IP for blocking comes only from the header Traefik sets.
- Container matches the edge: read-only root, all capabilities dropped,
  `no-new-privileges`, a memory and CPU cap (256 MB is the starting point, the same as the edge containers), one
  writable bind mount for the database, `/srv/play/data`.
- Traefik router with `sec`, `rl` and `inflight`, plus its own strict CSP with
  `connect-src 'self'` and `form-action 'self'`.

**Deploy (owner rule: GitHub Actions only, no deploys from the PC).** The restricted
deploy account has no docker access, and today's key can upload static sites, roll back any
site, and replace all of Traefik's routing through `edge-config`. A service needs a
new path, and this repo should not hold that much power. So `isoca-play` gets its
own key, limited to releasing and rolling back this one service. That needs a second
`authorized_keys` line and a way for `site-deploy` to limit verbs per key:

```
push to main (owner)
  -> Actions: tests, then build image, push to public GHCR, note its digest
  -> ssh, as the restricted deploy account: "release play sha256:..."      new verb in box/site-deploy
  -> site-deploy validates the digest, writes /srv/play/desired-image
  -> root systemd path unit sees the change, runs compose pull and up by digest
  -> Actions smoke check: /login answers 200 and the deployed version matches
```

This key can only name a digest of this one image, never run docker or touch the
edge. The route in `edge/dynamic/play.yml` ships through `isoca-infra`'s own workflow. The
box keeps the previous digest, and `rollback` restores it. Database changes must be
additive so a rollback stays safe. A rollback past the tips-and-maps release shows saves
on the new maps as unplayable until a new game replaces them.

**Changes in `isoca-infra`.**

- `edge/dynamic/play.yml`, the router and CSP.
- A compose file and systemd units for the service.
- The new `release` verb and `rollback` support in `box/site-deploy`, with tests.
- A reusable or caller workflow for the release.
- A runbook for the owner's root steps, in the owner's runbook format. It covers
  DNS, directories, units, setting the password, and a check that the login block
  and the "nothing without a session" rule hold on the real site.

**Process constraints.**

- The owner does every git push and PR merge. Work ends at local commits.
- Commits carry no Claude co-author trailer.
- No IP, SSH port or user names in either public repo.

## Order of work (owner)

The owner judges the feel and the art, and playtests early and as often as needed.
A builder cannot judge either, so the work stops for the owner at each check.

1. **Design check.** A private HTML artifact with the look, draft tiles and both game
   screens, playable enough to react to. No login or server. The owner adjusts it
   before the real build starts.
2. **First playtest.** Login, saves and deploy in place on `play.isoca.space`, with
   sudoku and one mahjong shape from each level with the approved tiles, so the owner can
   play on their phone.
3. **Tuning.** Adjust difficulty and rules feel from what the owner reports. A bot's
   win rate and forced holds can support this, but the owner's verdict decides.
4. **The rest.** Any further shapes, with the owner's look at
   each batch.

## Existing open source to check first (call)

No project found on 2026-10-31 has the 4-slot game or the no-warnings sudoku, so the
games are written here. Two parts may not need writing. Only READMEs and licenses
were read; none of these has been run.

- **Sudoku grading, server stage.** Try `huangsam/rustoku` first (MIT, Rust core with
  Python bindings, generates by difficulty), checking that its levels really follow
  the techniques needed. Fall back to `GillesArcas/sudosol` (MIT, pure Python, human
  techniques including X-wing, a solver only) under a small generator of our own.
- **Mahjong deals.** `gamefancreator/mahjong-solvable-deal` (MIT, no stars yet) builds
  deals backwards, the approach this design already uses. It is a reference only, as
  the rule is short and the 4-slot tuning is specific to this game.
- **Not used.** `ffalt/mahseum` (layouts, non-standard license) and GPL projects such
  as KMahjongg and `dokusan`, which do not fit an MIT repo.

## Left to the builder

- Further pixel art beyond the approved set, as long as it is original.
- Exact layouts, tile counts per level, and the deal-difficulty measure.
- Screen details beyond the drawings, including the home page.
- Sudoku generation approach, within the grading rule above.
- Test tooling. The rules and generators must have automated tests: every generated
  mahjong deal is winnable, and every sudoku has one solution and its stated grade.
