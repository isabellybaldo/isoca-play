# Solitaire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add draw-one Klondike with only proven-winnable deals to isoca-play, played by double tap and drag, with saves, Return, tips and offline play like the other games.

**Architecture:** Rules are one plain TypeScript module with a Python twin kept in step by shared cases. Python makes a pack of deals, each with a winning move list that a test replays, and the server hands out deals without those lists. The React screen is split into pure sizing, pure drop-target logic, and the component that uses them.

**Tech Stack:** TypeScript, React, Vite, Vitest, Testing Library, playwright-core (e2e), Python, FastAPI, pytest. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-solitaire-design.md`. Read it first; this plan does not repeat its rules.

## Global Constraints

- Branch `solitaire`, already created. The owner does every git push and PR merge: commit locally only.
- Commits carry no Claude co-author line. This is the project's rule and overrides any default trailer.
- No new runtime dependencies in the server or web app. No requests to third parties.
- The solver is a tool-only dependency in `tools/requirements.txt`. Never in the server or image.
- Mobile first: an Android phone. Pointer events, with mouse working too.
- Whole-number card scales only. The page does not scroll during play.
- Existing saves, tests, CSP and the offline e2e stay green.
- Do not copy from `ckonig/solitaire`, `mmendesas/solitaire` or the Phaser pack.
- Colours and fonts come from `web/src/theme.css`, apart from the card art's own colours.
- Server tests: `cd server && python -m pytest -q`. Web tests: `cd web && npx vitest run`. Types and build: `cd web && npm run build`.

## Review Focus

- A vertical drag on Android must move the card, not scroll the page. `theme.css` sets `touch-action: manipulation` on `*`, so it matches every child and a rule on the table alone loses. Pinned in Task 5's CSS test.
- The browser cancelling a drag (`pointercancel`, a notification, a rotation) must snap back and change nothing. Pinned in Task 5.
- A save from another device arriving mid-drag, or under an open tip, must not move a card on stale data or show a stale highlight. Pinned in Task 5.
- A third fast tap after a double tap sent a card up must not count as a double tap on the card now on top. Pinned in Task 5.
- An unreadable save must never be replaced without the confirming tap, and the automatic first deal must fire once and never overwrite a game that has just loaded. Pinned in Task 6.

---

### Task 1: Rules, in two languages

**Files:**
- Create: `web/src/solitaire/rules.ts`, `tools/solitaire_rules.py`, `tools/make_solitaire_cases.py`, `shared/solitaire-cases.json`
- Modify: `server/tests/test_image.py:143` (add the new shared and tool file names to that list)
- Test: `web/src/solitaire/rules.test.ts`, `server/tests/test_solitaire.py`

**Interfaces:**
- Produces, in `rules.ts`:

```ts
// A card is 0-51: suit * 13 + rank - 1. Suits: 0 heart, 1 diamond, 2 club, 3 spade. Rank 1 is the ace.
// A deal is 52 cards: the first 28 fill columns 0 to 6 in turn, each column's last card on top;
// the last 24 are the pile, deal[28] turned first.
export type Pile = 'w' | `f${0|1|2|3}` | `c${0|1|2|3|4|5|6}`;
// 'd' turns a card, 'r' turns the pile back over, 'c3>c5:2' moves 2 cards. A history entry
// adds '!' when the move turned a face-down card over.
export type Move = string;
export type Column = { down: number[]; up: number[] };   // last of each is nearest the top
export type SolitaireState = {
  deal: number[];
  stock: number[];       // stock[0] turns next
  waste: number[];       // last is on top
  columns: Column[];     // 7
  foundations: number[]; // 4 counts, by suit
  history: Move[];
  status: 'playing' | 'won';
};
export const suitOf: (card: number) => number;
export const rankOf: (card: number) => number;
export const isRed: (card: number) => boolean;
export function newSolitaire(deal: number[]): SolitaireState;
export function tapPile(s: SolitaireState): SolitaireState;        // 'd' or 'r'; same object if both piles are empty
export function canMove(s: SolitaireState, from: Pile, to: Pile, n: number): boolean;
export function move(s: SolitaireState, from: Pile, to: Pile, n: number): SolitaireState; // same object if invalid
export function sendUp(s: SolitaireState, from: Pile): SolitaireState;  // double tap; same object if it can't go
export function applyMove(s: SolitaireState, m: Move): SolitaireState;  // same object if invalid
export function undo(s: SolitaireState): SolitaireState;           // same object with no history
export function hasMovesToLose(s: SolitaireState): boolean;        // history, and not won
```

- Produces, in `solitaire_rules.py`: `new_game(deal) -> dict` and `apply_move(state, move) -> dict | None` (`None` if invalid), with the same field names, plus `random_move(state, rng)`.

- [ ] **Step 1: Write failing unit tests in `rules.test.ts`**

Build each position by hand. Named tests, one assertion set each: `deals seven columns and a pile of 24`; `tapping turns one card and an empty pile turns back in the original order`; `alternating colours one rank down lands`; `same colour or wrong rank returns the same object`; `only a king or a run headed by a king starts an empty column`; `a run moves together`; `uncovering a face-down card turns it over in the same move`; `answer piles go ace up by suit`; `the top of an answer pile moves back to a column`; `only one card at a time goes to an answer pile`; `sendUp refuses a card that cannot go`; `undo restores a turned-over card to face down`; `undo of 'r' and of 'd' restores the piles`; `undo from an answer pile restores it`; `undo all the way returns to the starting piles`; `52 on the answer piles is won`; `moves are ignored after a win but undo reopens the game`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/solitaire/rules.test.ts`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement `rules.ts`**

History holds only the short strings above, never copies of state, so `undo` works backwards from the move and its `!`. New arrays on change only, as the other rules modules do, because `MOVED` compares by identity.

- [ ] **Step 4: Run them and see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Write `solitaire_rules.py` and `make_solitaire_cases.py`, then generate the cases**

`python tools/make_solitaire_cases.py` writes 20 seeded walks of 200 steps. Each step records `{"move", "valid"}`; about a third of the steps are random moves that may be invalid. Each walk records its `deal` and final `stock`, `waste`, `columns`, `foundations`, `status`. Same seed, same file.

- [ ] **Step 6: Write the shared-case tests**

In `rules.test.ts`, `the shared walks agree with Python`: replay each walk with `applyMove`. A step is valid exactly when the object changed; the final fields equal the record; then `undo` to the start restores `newSolitaire(deal)` apart from nothing.

In `test_solitaire.py`, `test_shared_walks_replay` does the same with `apply_move`, and `test_shared_walks_are_up_to_date` regenerates and compares with the committed file.

- [ ] **Step 7: Run both suites**

Run: `cd web && npx vitest run src/solitaire` and `cd server && python -m pytest tests/test_solitaire.py tests/test_image.py -q`. Expected: PASS.

- [ ] **Step 8: Commit**

`git commit -m "solitaire: rules in TypeScript and Python, with shared walks"`

---

### Task 2: The winnable pack and the server route

**Files:**
- Create: `tools/make_solitaire_pack.py`, `server/isoca_play/data/solitaire_pack.json`, `server/isoca_play/solitaire.py`
- Modify: `tools/requirements.txt`, `server/isoca_play/app.py` (install the router), `server/isoca_play/saves.py:20` (add `solitaire` to `GAMES`), `web/public/sw.js:13` (add `solitaire`), `server/tests/test_image.py:143` if needed, `web/src/api.ts`
- Test: `server/tests/test_solitaire.py`, `server/tests/test_saves.py`

**Interfaces:**
- Consumes: `new_game`, `apply_move` from Task 1.
- Produces: `POST /api/new/solitaire`, body `{"not"?: number[]}`, answers `{"deal": number[]}`. Pack format: `[{"deal": number[], "moves": string[]}]`. In `api.ts`: `GameName` includes `'solitaire'`, and `newSolitaire(not?: number[]): Promise<{ deal: number[] }>`. Import it under another name where it would clash with the rules' `newSolitaire`, as `SudokuGame.tsx` does.

- [ ] **Step 1: Try the solver and record what you find**

Install `py-klondike-solver` in a throwaway venv. Confirm it runs on this machine, that it plays draw one with unlimited passes, and that its output converts to Task 1's moves. If it fails, try in order: the C++ `ShootMe/Klondike-Solver`, `ShootMe/MinimalKlondike`, then a small bounded search in Python inside the tool. Pin what works in `tools/requirements.txt` with a comment like the rustoku one, and name the choice in the commit message.

- [ ] **Step 2: Write failing tests in `test_solitaire.py`**

```python
def test_every_pack_deal_is_a_permutation(): ...       # sorted(deal) == list(range(52))
def test_pack_has_500_different_deals(): ...
def test_every_pack_deal_is_won_by_its_moves(): ...    # replay with apply_move: every move valid, ends 'won'
def test_new_answers_a_pack_deal_without_its_moves(client_logged_in): ...  # keys == {"deal"}
def test_not_changes_the_deal(client_logged_in): ...   # 50 asks with not=X never answer X
def test_new_needs_a_session(client): ...              # 401
def test_new_needs_the_origin(client_logged_in): ...   # as test_sudoku.py does it
def test_too_large_is_refused(client_logged_in): ...   # 413
```

Add `solitaire` to the round-trip in `test_saves.py`.

- [ ] **Step 3: Run them and see them fail**

Run: `cd server && python -m pytest tests/test_solitaire.py -q`. Expected: FAIL.

- [ ] **Step 4: Write `make_solitaire_pack.py`**

Fixed `SEED`, `PER_PACK = 500`. Shuffle, ask the solver with a time limit per deal, convert its moves, replay them through `apply_move`, and keep the deal only if it ends won. A deal not settled in time is discarded. `--stats` prints how many were tried and discarded and the move-list lengths. Generate the file.

- [ ] **Step 5: Write `solitaire.py`**

Modelled on `sudoku.py`: same body handling, a non-object body counts as `{}`, `secrets.choice` over deals other than `not`, and `NO_STORE`. Add `newSolitaire` to `api.ts`.

- [ ] **Step 6: Run the server suite**

Run: `cd server && python -m pytest -q`. Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -m "solitaire: a pack of proven deals and the route that hands them out"`

---

### Task 3: Card art and sizing

**Files:**
- Create: `web/src/solitaire/CardArt.tsx`, `web/src/solitaire/layout.ts`
- Modify: `web/src/mahjong/TileArt.tsx` (export `Pixels`, `runs` and `Paint` only if reusing them is simpler than a copy)
- Test: `web/src/solitaire/CardArt.test.tsx`, `web/src/solitaire/layout.test.ts`

**Interfaces:**
- Consumes: `suitOf`, `rankOf`, `SolitaireState` from Task 1.
- Produces:

```ts
// CardArt.tsx
export function CardFace(props: { card: number }): JSX.Element;
export function CardBack(): JSX.Element;
export function EmptyAnswerPile(props: { suit: number }): JSX.Element;
export const cardName: (card: number) => string;   // "7 of clubs"
// layout.ts
export const SPRITE = { width: 16, height: 24 };
export const TABLE_CHROME = 116;  // 8 + 44 bar + 6 + 44 tip line + 6 + 8. The top row and its 6 px gap are extra.
export function cardScale(vw: number, vh: number): 2 | 3 | 4;
export function cellWidth(vw: number, scale: number): number;
export function columnPitches(column: { down: number; up: number }, scale: number, available: number):
  { down: number; up: number };   // px; whole sprite rows only
```

- [ ] **Step 1: Write failing tests**

`layout.test.ts`:

```ts
expect(cardScale(320, 568)).toBe(2);
expect(cardScale(355, 800)).toBe(2);
expect(cardScale(360, 640)).toBe(3);  // the width rule, and the worst column fits tight
expect(cardScale(360, 560)).toBe(2);  // height wins over the 356 px rule
expect(cardScale(915, 412)).toBe(2);  // a phone on its side
// the worst column, 6 down and 13 up, always fits
for (const [vw, vh] of [[320,568],[360,640],[412,915]]) {
  const s = cardScale(vw, vh);
  const top = 24 * s + 6;
  const p = columnPitches({ down: 6, up: 13 }, s, vh - TABLE_CHROME - top);
  expect(6 * p.down + 12 * p.up + 24 * s).toBeLessThanOrEqual(vh - TABLE_CHROME - top);
  expect(p.up).toBeGreaterThanOrEqual(9 * s);  // the rank ends at sprite row 8
}
expect(columnPitches({ down: 2, up: 2 }, 3, 500)).toEqual({ down: 12, up: 30 });
expect(cellWidth(320, 2)).toBeGreaterThanOrEqual(44);  // the tap area stays wide
```

`CardArt.test.tsx`: every sprite row is 5 wide (7 for the 10) or 14 wide for courts; all 52 faces render with a distinct label from `cardName`; court cards draw the frog, bunny and cat.

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/solitaire`. Expected: FAIL.

- [ ] **Step 3: Implement**

Port the sprite data and drawing unchanged from artifact `9b98bb20-adc4-4d32-828f-880409f67e8a` (read it with the artifacts tool), version `1793571029-8f4c`: face `ivory`, back `stars`, and the empty-pile drawing with suit art. Draw as SVG in the manner of `TileArt.tsx`, not canvas. `cardScale` returns the largest of 4, 3, 2 whose seven cards fit across (`7 * w + 12 + 8`) and whose worst column at tightest pitch fits down, otherwise 2. `columnPitches` starts at 4 rows down and 10 rows up, cuts down cards first to 1 row, then up cards to 9 rows. `cellWidth` is `min(cardWidth + 8, max(cardWidth + 2, floor((vw - 8) / 7)))`.

- [ ] **Step 4: Run them and see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "solitaire: the approved cards, and sizes for the table"`

---

### Task 4: Tips

**Files:**
- Create: `web/src/solitaire/tips.ts`
- Test: `web/src/solitaire/tips.test.ts`

**Interfaces:**
- Consumes: Task 1's rules, and the pack for the loop test.
- Produces:

```ts
export type Tip =
  | { kind: 'move'; from: Pile; to: Pile; n: number; line: string }
  | { kind: 'turn'; line: string }       // tap the pile
  | { kind: 'none'; line: string };      // no move stands out; Return can back up
export function tipFor(s: SolitaireState): Tip;
```

- [ ] **Step 1: Write failing tests**

One hand-built position per spec rule, each proving first match wins: `turns over a face-down card first`; `a safe move to an answer pile`, including `aces and twos are always safe` and `a card above the safe rank is not tipped by rule 2`; `a king into an empty column only if it uncovers something`; `any other move from the face-up pile`; `otherwise turn the pile`; `after a whole pass with no other move, none`; `an empty pile and no move, none`. Then `a tip never reads the unseen pile`: two states differing only in `stock` order give the same tip. Then `following tips always ends`: across 50 pack deals, apply tips until `none` or won; must end within 5,000 steps.

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/solitaire/tips.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `tipFor`**

Rule 2's test: rank at most 1 above the lower of the two opposite-colour answer-pile counts, or rank 2 or below. Check rule 6 before rule 5: count `d` entries in the unbroken run of `d` and `r` at the end of history; if that is at least `stock + waste` cards, answer `none`. Plain lines in the game's voice.

- [ ] **Step 4: Run them and see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "solitaire: tips from what the player can see"`

---

### Task 5: The table

**Files:**
- Create: `web/src/solitaire/SolitaireTable.tsx`, `web/src/solitaire/drag.ts`, `web/src/solitaire/solitaire.css`
- Test: `web/src/solitaire/drag.test.ts`, `web/src/solitaire/SolitaireTable.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 3 and 4.
- Produces:

```ts
// drag.ts: pure geometry
export type PileBox = { pile: Pile; left: number; right: number; top: number; bottom: number };
export function dropPile(boxes: PileBox[], x: number, y: number): Pile | null;
// SolitaireTable.tsx
export default function SolitaireTable(props: {
  state: SolitaireState;
  onChange: (update: (s: SolitaireState) => SolitaireState) => void;
}): JSX.Element;   // the top row, the columns, gestures and the tip's highlight
export function useTip(state: SolitaireState): { tip: Tip | null; ask: () => void };  // cleared when state.history changes identity
```

Column boxes run from the top of the column to the bottom of the screen, so a drop anywhere below a column lands on it. `x, y` is the centre of the dragged head card.

- [ ] **Step 1: Write failing tests**

`drag.test.ts`: `dropPile` picks the column under the point, an answer pile in the top row, and `null` in a gap.

`SolitaireTable.test.tsx`, using `fireEvent.pointerDown/Move/Up`:
- `a tap on the pile turns a card`, and `a tap on the empty pile turns it back`.
- `a double tap sends a card that can go up`; `a double tap on a card that cannot go changes nothing`; `a double tap on a buried card changes nothing`; `a double tap never moves a card to a column`.
- `a third fast tap does not send the card now on top`.
- `two taps on different cards are not a double tap`; `two slow taps are not a double tap`.
- `a drag that lands moves the run`; `a drag from a run's middle brings the cards below it`; `a released invalid drag changes nothing`; `a drag onto an answer pile lands`; `a drag from an answer pile back to a column lands`.
- `pointercancel snaps back and changes nothing`.
- `a small wobble under the threshold counts as a tap, not a drag`.
- `a state change mid-drag ends the drag`: rerender with a new `state`, release over a pile, nothing is applied from the old state.
- `the tip highlights and a new state clears it`, and `a tip changes nothing`.

Also in that file, reading `solitaire.css` as `theme.test.ts` reads CSS: `the table and everything in it opts out of panning`, requiring `.sol-table, .sol-table *` with `touch-action: none`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/solitaire`. Expected: FAIL.

- [ ] **Step 3: Implement**

Cards absolutely positioned from `layout.ts`, each with its `cardName` label. Use `setPointerCapture`, a drag threshold of 8 px, and a double tap of two tap-ups on the same card within 350 ms, resetting after a send. A drag follows through `transform`. Every landing goes through `onChange((s) => move(s, ...))`, so rules decide against the latest state. `.sol-table` and its children also set `user-select: none`, and the page has `overscroll-behavior: none` while this screen shows.

- [ ] **Step 4: Run them and see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "solitaire: the table, with double tap and drag"`

---

### Task 6: The game screen and saving

**Files:**
- Create: `web/src/solitaire/SolitaireGame.tsx`
- Modify: `web/src/App.tsx`, `web/src/useSavedGame.ts`, `web/e2e/offline.mjs`, `README.md`
- Test: `web/src/solitaire/SolitaireGame.test.tsx`, `web/src/useSavedGame.test.tsx`, `web/src/solitaire/rules.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2 and 5. `startNote`, `newGameProblem`, `REPLACE_UNPLAYABLE` from `api.ts`, and `ConfirmDialog`.
- Produces: `Screen` includes `'solitaire'`, and `Saved` has `solitaire: SolitaireState`. Props:

```ts
SolitaireGame(props: {
  game: SolitaireState | null;
  onGame: (update: SetStateAction<SolitaireState | null>) => void;
  ready: boolean; online: boolean; unplayable: boolean; onBack: () => void;
})
```

- [ ] **Step 1: Write failing tests**

`SolitaireGame.test.tsx`, with the fake server from `fakeServer.testutil.ts`:
- `a saved game opens at once, with no request for a deal`.
- `no save: one deal is asked for, with no confirming tap`, under `StrictMode`, asserting exactly one request.
- `a load that answers with a game while no deal is out asks for none`, and `a game arriving while a deal is on its way is not overwritten`: `onGame` uses the update form and keeps a non-null game.
- `offline with no save: the note and Back, no request`.
- `an unreadable save is not replaced until New game is confirmed`, showing `REPLACE_UNPLAYABLE`.
- `a failed deal shows the problem, and New game tries again`.
- `New game with moves asks first; Keep playing stays on the table`.
- `New game with no moves, or after a win, does not ask`.
- `New game is disabled offline, with the note`.
- `New game sends the deal on screen as not`.
- `Back goes home`; `Return is disabled with no history`; `Tip is disabled after a win`; `a win shows its note`.

`useSavedGame.test.tsx`: `isPlayableSolitaire` refuses a deal that is not 52 different cards, a card count across the piles that is not 52, and an unknown status; accepts a save with unknown extra fields. `MOVED.solitaire` is true for a change in `deal` or `history`.

`rules.test.ts`: `a game of 20,000 moves saves in under 512 KB`, using draw and turn-back moves, measured with `JSON.stringify`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/solitaire src/useSavedGame.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement**

`SolitaireGame.tsx`: a 44 px bar with Back, Return, Tip and New game on one row at 320 px, a 44 px line always reserved for tip and end notes, then the table, using `TABLE_CHROME`. The first deal starts from an effect, guarded by a ref, when `ready && online && !game && !unplayable`. The `.sol-table` screen does not scroll.

`App.tsx`: add a third `useSavedGame('solitaire')` to `sessionGone`, `sessionAlive`, the `flush` list, `worst`, `refused`, `checking` and the save marker's `signedOut`; add a screen wrapped in `GameBoundary name="Solitaire"`. `useSavedGame.ts`: `PLAYABLE` and `MOVED`.

`offline.mjs`: add solitaire to the kept-saves check, and a check named `solitaire resumes offline too` in the manner of the mahjong one. `README.md`: three games, and a short paragraph on solitaire and how its deals are proved.

- [ ] **Step 4: Run all the checks**

Run: `cd web && npx vitest run && npm run build`, `cd server && python -m pytest -q`, then the offline e2e as `web/e2e/offline.mjs` describes. Expected: all PASS. Existing tests that fix the number of `useSavedGame` calls or requests may need solitaire added; change those only for that reason.

- [ ] **Step 5: Commit**

`git commit -m "solitaire: the game screen, its save and the app's wiring"`

---

### Task 7: The home card, shown first

**Files:**
- Modify: `web/src/Home.tsx`, `web/src/theme.css`
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: `CardFace`, `CardBack` from Task 3. `Screen` from Task 6.

- [ ] **Step 1: Draw the card and the three-card home page in the artifact**

Republish artifact `9b98bb20-adc4-4d32-828f-880409f67e8a` with `publish_files` or `edit_version`, keeping its other sections: a new section showing the real home page at phone and computer widths. The solitaire card has a loose heap of cards in the manner of `.heap`, its name, and the line "Stack them down, send them home."

- [ ] **Step 2: STOP and wait for the owner's reaction**

Report the link. Make the owner's changes and show them again until they approve. Do not continue without approval.

- [ ] **Step 3: Write the failing test**

In `App.test.tsx`, `the solitaire card opens the solitaire screen`, and all three game cards are present.

- [ ] **Step 4: Run it and see it fail**

Run: `cd web && npx vitest run src/App.test.tsx`. Expected: FAIL.

- [ ] **Step 5: Implement as approved**

- [ ] **Step 6: Run everything**

Run: `cd web && npx vitest run && npm run build` and `cd server && python -m pytest -q`. Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -m "solitaire: its card on the home page"`

- [ ] **Step 8: Play it in a real browser at phone size and report**

Run the app locally and drive it at 360 x 800 with touch enabled: start a deal, double tap an ace up, drag a run, Return, Tip, reload to resume. Report what you saw. The owner's own check on their phone follows after they push: the work ends at local commits.
