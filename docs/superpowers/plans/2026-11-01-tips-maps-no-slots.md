# Tips, More Maps, No-Slots Mahjong and Keep Playing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tap-only tips to both games, nine new mahjong maps, a no-slots mahjong mode and a working "Keep playing", and list isoca-play in the portfolio and READMEs.

**Architecture:** Everything new runs in the browser. A TypeScript port of the Python grader's techniques produces tips, proved against the grader by a generated fixture. Tips are transient component state, never saved. No-slots is one optional field on the saved mahjong state. New maps are data in `shared/layouts.json`.

**Tech Stack:** React 19, TypeScript, Vitest and Testing Library; Python 3.10+ and pytest for the fixture, server and tests; Astro for the portfolio.

**Spec:** `docs/superpowers/specs/2026-11-01-tips-maps-no-slots-design.md`. Read it first: it holds the rules and copy this plan doesn't repeat.

## Global Constraints

- A tip never writes a digit, changes a note, counts as a move, adds to Return or is saved.
- Nothing warns unprompted: no red numbers, no mistake count, no timer.
- Saves without `noSlots` keep loading as slots games. Don't tighten `isPlayableMahjong`.
- No new runtime dependencies, and nothing new leaves the browser.
- Public repos: nothing may depend on secrecy.
- The owner does every git push. Commit locally only. Commits carry no Claude co-author line.
- Android phone first. iOS Safari doesn't matter.
- Work on branch `tips-maps-no-slots` in isoca-play. Before pushing, CI's commands all pass: `npm test` and `npm run build` in `web/`, `python -m pytest -q` in `server/`.
- Task 8 stops for the owner's approval of the drawings. Don't ship shapes without it.

## Review Focus

- A sudoku board with wrong numbers and a board with none: wrong numbers show alone, with no move (Task 6).
- A tip open when Return, a new digit or another device's save changes the board: the tip closes instead of showing stale squares (Task 6, Task 7).
- Mahjong with 3 slots full and two open tiles matching: the tip must not lead to a lost game (Task 7).
- No-slots game whose last removal leaves no open pair, then Return: status returns to playing (Task 2).
- A held game on a phone at 320 x 568 with the slots row hidden: the board still fits, and four map cards per level are reachable (Task 3, Task 8).

---

### Task 1: Keep playing returns to the board

**Files:**
- Modify: `web/src/App.tsx:111-123`, `web/src/sudoku/SudokuGame.tsx:260-272`
- Test: `web/src/App.test.tsx`, `web/src/sudoku/SudokuGame.test.tsx`

**Interfaces:**
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing tests**

From each setup screen with a held game with moves: tap a level or map, then "Keep playing", and expect the board (`role="group"`, name "Board"). In mahjong, with the picker on another level, also expect Back to show the held game's level. With an unplayable save and no game: "Keep playing" closes the dialog and the setup screen stays.

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -- App.test SudokuGame.test` in `web/`. Expected: the new tests FAIL, finding no Board.

- [ ] **Step 3: Implement**

In `onKeep`, clear the dialog, then if `game` is non-null call `setPlaying(true)`. In mahjong also call `onLevel(layout.level)` first, as Resume does.

- [ ] **Step 4: Run them and see them pass**

Run: `npm test -- App.test SudokuGame.test`. Expected: PASS.

- [ ] **Step 5: Commit**: `web: Keep playing goes back to the board in both games`

### Task 2: No-slots rules

**Files:**
- Modify: `web/src/mahjong/rules.ts`
- Test: `web/src/mahjong/rules.test.ts`, `web/src/mahjong/shared.test.ts`

**Interfaces:**
- Produces: `MahjongState.noSlots?: boolean`; `newGame(tiles: Tile[], options?: { noSlots?: boolean }): MahjongState`, which leaves the field absent for slots games; `freePairs(s: MahjongState): [number, number][]`, in `onBoard` order, used by Task 7.

- [ ] **Step 1: Write the failing tests**

With `noSlots`: `tap` first tile selects; `tap` a free non-match moves `selected` to it; `tap` the selected tile again gives `selected: null` and no history; `tap` a free match removes both, leaves `slots` empty, adds one history entry; clearing the board gives `won`; a removal leaving tiles and `freePairs` empty gives `lost`; `undo` from that gives `playing`, with both tiles back. A season pairs with a different season. A state without the field behaves exactly as today. In `shared.test.ts`, each deal sample wins without slots via a search through `tap`, like `canWin`.

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -- rules.test shared.test`. Expected: FAIL.

- [ ] **Step 3: Implement** `freePairs`, the option, and a `noSlots` branch at the top of `tap`, leaving the slots path untouched. A removal goes through one helper that pushes the same history entry shape as `send`.

- [ ] **Step 4: Run them and see them pass**

Run: `npm test -- rules.test shared.test`. Expected: PASS.

- [ ] **Step 5: Commit**: `web: mahjong rules without slots`

### Task 3: No-slots on screen

**Files:**
- Modify: `web/src/mahjong/MahjongSetup.tsx`, `web/src/mahjong/MahjongGame.tsx`, `web/src/mahjong/boardSize.ts`, `web/src/ResumeButton.tsx`, `web/src/App.tsx`, `web/src/mahjong/mahjong.css`
- Test: `web/src/mahjong/MahjongGame.test.tsx`, `web/src/App.test.tsx`, `web/src/mahjong/boardSize.test.ts`

**Interfaces:**
- Consumes: Task 2's `newGame` option and `noSlots`.
- Produces: `tileWidth(layout, viewportWidth, viewportHeight, options?: { noSlots?: boolean })`, which subtracts the 54 px slots row and one 8 px gap from `GAME_CHROME` when set.

- [ ] **Step 1: Write the failing tests**

A switch named "Slots" on setup, pressed by default; off, a started game has `noSlots: true` and shows no "Slots" list. The choice survives a remount, through `localStorage` key `isoca-play-mahjong-slots`. New game inside a no-slots game stays no-slots. Resume reads "Resume Frame, no slots, 3 moves". The lost note reads "No open pair left. Return takes the last move back." `tileWidth` picks 54 for a viewport where only the no-slots height fits.

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -- MahjongGame.test App.test boardSize.test`. Expected: FAIL.

- [ ] **Step 3: Implement.** A failed `localStorage` read or write falls back to slots on. The switch stays usable while a game is held, and only affects the next start.

- [ ] **Step 4: Run them and see them pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**: `web: a Slots switch, and a board without the slots row`

### Task 4: The tip engine and its proof

**Files:**
- Create: `web/src/sudoku/tips.ts`, `web/src/sudoku/tips.test.ts`, `tools/make_tip_cases.py`, `shared/tip-cases.json`
- Modify: `server/tests/test_sudoku.py`

**Interfaces:**
- Produces:

```ts
export type Candidate = { cell: number; digit: number };
export type TipStep = {
  technique: string;     // the grader's name, e.g. 'XY-Wing'
  cells: number[];       // the squares that prove it, in the order to draw them
  unit?: { kind: 'row' | 'column' | 'box'; index: number };
  removes: Candidate[];  // empty on the last step
  places?: Candidate;    // only on the last step
  relies: Candidate[];   // the candidates that must be absent for this step to hold
  because: string;       // the one or two plain lines shown
};
export function fullChain(values: number[]): TipStep[];  // every step, in the grader's order
export function tipChain(values: number[]): TipStep[];   // Task 5: only those that matter
```

- [ ] **Step 1: Write the fixture generator**

`tools/make_tip_cases.py` uses `sudoku_grader` unchanged. For each board in the pack, from the givens, repeat until full: load the written digits fresh, run `TECHNIQUES` simplest first, collecting names, until one places a digit; record the names; write that digit. Each board's output is a string of technique indices, with tips separated by commas, plus the placed cells and digits. `shared/tip-cases.json` is a list of `{givens, solution, tips}`. A check in `server/tests/test_sudoku.py` runs the generator's function on 5 boards and compares them with the file, so it can't go stale.

- [ ] **Step 2: Run the generator**

Run: `python tools/make_tip_cases.py`. Expected: writes 900 boards, every one ending at its `solution`.

- [ ] **Step 3: Write the failing test**

In `tips.test.ts`, for every board in the fixture, `fullChain` gives the fixture's exact technique names, then the same placement, at each tip. No `removes` entry ever removes the solution's digit from its cell. Also one hand-written case per technique for `cells`, `unit` and `because`. Use a 120-second timeout.

- [ ] **Step 4: Run it and see it fail**

Run: `npm test -- tips.test`. Expected: FAIL, module not found.

- [ ] **Step 5: Implement `fullChain`**

Port each technique, keeping `tools/sudoku_grader.py`'s iteration order, because the fixture pins it, including that a technique removing nothing does not fire. Bits and cell numbering match the grader. Each step records `relies`:

| Technique | Relies on being absent |
|---|---|
| Naked Single, Naked Pair, Naked Triple | every other digit, in the proving cells |
| Hidden Single, Hidden Pair, Hidden Triple | those digits, in the unit's other cells |
| Locked Candidates | that digit, in the rest of the box or line |
| X-Wing, Swordfish | that digit, in the rest of the base lines |
| XY-Wing | every other digit, in the pivot and both pincers |

Don't list what written digits rule out in a way that matters: Task 5 treats any candidate no step removed as a given fact.

- [ ] **Step 6: Run it and see it pass**

Run: `npm test -- tips.test`, and `python -m pytest -q tests/test_sudoku.py` in `server/`. Expected: PASS.

- [ ] **Step 7: Commit**: `web: the sudoku tip engine, proved against the grader on the whole pack`

### Task 5: Only the steps that matter

**Files:**
- Modify: `web/src/sudoku/tips.ts`, `web/src/sudoku/tips.test.ts`

**Interfaces:**
- Consumes: `fullChain`.
- Produces: `tipChain(values: number[]): TipStep[]`, whose last step has `places`.

- [ ] **Step 1: Write the failing tests**

Over the fixture, at every tip, for `tipChain`: the last step's placement equals `fullChain`'s; the kept steps are a subsequence of `fullChain`; replaying them from fresh candidates, every entry of each kept step's `relies` is absent when that step runs, and each kept `removes` is present before it. Every kept step but the last has at least one removal a later kept step relies on. A one-step `fullChain` is unchanged. Report the longest chain and the share of one-step tips in the test's output.

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -- tips.test`. Expected: FAIL.

- [ ] **Step 3: Implement `tipChain`**

Walking back through what each step relied on:

```ts
// removedBy: for each Candidate, the index of the fullChain step that removed it.
// needed = last step's relies. Walk the steps from last to first:
//   keep a step if it removed something in needed; then trim its removes to those
//   entries, and add its own relies to needed.
```

A candidate no step removed was ruled out by written digits, so it needs nothing kept.

- [ ] **Step 4: Run them and see them pass**

Run: `npm test -- tips.test`. Expected: PASS. Note the longest chain for the final report.

- [ ] **Step 5: Commit**: `web: a tip keeps only the steps that lead to its number`

### Task 6: Sudoku tips on screen

**Files:**
- Modify: `web/src/sudoku/SudokuGame.tsx`, `web/src/sudoku/sudoku.css`, `web/src/sudoku/rules.ts`
- Test: `web/src/sudoku/SudokuGame.test.tsx`, `web/src/sudoku/rules.test.ts`

**Interfaces:**
- Consumes: `tipChain`, `TipStep`.
- Produces: `wrongCells(s: SudokuState): number[]` in `rules.ts`: written, non-given cells differing from `puzzle.solution`.

- [ ] **Step 1: Write the failing tests**

- A Tip button sits beside Return; it is disabled when won.
- With no tap, no highlight or tip text appears, whatever the board holds.
- With a wrong number: every wrong cell has class `is-wrong` and its label ends ", wrong"; the text says to fix those first; no Next button. This also applies on a full "Not solved" board.
- With none: the step's `cells` have class `is-tip`, removed candidates show as text, and `because` appears under the board. Next walks the chain, and the last step marks the placed square. Close clears it.
- A tip leaves `values`, `notes`, `history` and `status` identical, and sends no save.
- After Return, a digit, a note or a newly loaded `state.values`, the tip is gone.

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -- SudokuGame.test rules.test`. Expected: FAIL.

- [ ] **Step 3: Implement** with `useState` in `Game`, holding the chain and the step index. Close the tip when `state.values`, `state.notes` or `state.history` change identity. Compute on tap, not on render.

- [ ] **Step 4: Run them and see them pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**: `web: sudoku tips, on tap only`

### Task 7: Mahjong tips

**Files:**
- Create: `web/src/mahjong/tips.ts`, `web/src/mahjong/tips.test.ts`
- Modify: `web/src/mahjong/MahjongGame.tsx`, `web/src/mahjong/mahjong.css`
- Test: `web/src/mahjong/MahjongGame.test.tsx`

**Interfaces:**
- Consumes: `freePairs`, `isFree`, `isCovered`, `matchKey`.
- Produces: `mahjongTip(s: MahjongState): { tiles: number[]; line: string }`.

- [ ] **Step 1: Write the failing tests**

In the spec's order: slot match, then 3 slots full (no `tiles`, and `line` names Return, even when two free tiles match), then a free pair, then the free tile freeing the most. No-slots uses only the free pair rule, and a playing no-slots state always has one. Changing the face of a covered tile never changes the answer. In the component: Tip beside Return and New game, disabled unless playing; `is-tip` on those tiles and the line shown; the tip doesn't change state or send a save, and tapping the Tip button doesn't deselect; any change to `onBoard` or `slots` clears it.

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -- mahjong/tips.test MahjongGame.test`. Expected: FAIL.

- [ ] **Step 3: Implement.** Ties for "frees the most" go to the earliest in `onBoard`. Count a removal's gain by comparing `isFree` across the tiles with and without it, on a copy of the state.

- [ ] **Step 4: Run them and see them pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**: `web: mahjong tips from what is visible`

### Task 8: Nine new maps

**Files:**
- Modify: `shared/layouts.json`, `server/isoca_play/shared/layouts.json`, `shared/deal-samples.json`, `web/src/mahjong/layouts.test.ts`, `server/tests/test_mahjong.py`, `web/src/mahjong/mahjong.css`
- Test: same test files

**Interfaces:**
- Consumes: the layout format in `web/src/mahjong/layouts.ts`.
- Produces: map ids `heart`, `cat`, `cherry`, `butterfly`, `panda`, `moon`, `rose`, `frog`, `gate`.

- [ ] **Step 1: Draw all nine and publish them for approval**

Draft the layers in the scratchpad, in the format of `shared/layouts.json`. Publish a private artifact showing each shape with the `ShapeDrawing` stack colours, its name, tiles and layers. Call `mcp__claude-artifacts__guide` first. Look at each as a silhouette, including for anything rude.

- [ ] **Step 2: STOP. Wait for the owner's reaction, and redraw until they approve**

- [ ] **Step 3: Update the tests**

`layouts.test.ts`: four shapes per level, the ids above, each level's layers (`easy` 2, `medium` 3, `hard` 4). Keep the left-to-right test on `frame`, `trophy` and `fort` only. Apply the other shape checks to all. `test_mahjong.py`: the sizes test lists all twelve at their approved counts, and every map deals 50 times without `DealError`.

- [ ] **Step 4: Run them and see them fail**

Run: `npm test -- layouts.test` and `python -m pytest -q tests/test_mahjong.py`. Expected: FAIL.

- [ ] **Step 5: Add the approved shapes** to both `layouts.json` files, regenerate samples with `server/tools/write_deal_samples.py`, and make the map cards fit a phone in `mahjong.css`.

- [ ] **Step 6: Run the whole suites**

Run: `npm test`, `npm run build` in `web/`, `python -m pytest -q` in `server/`. Expected: PASS, including the file-equality and sample win tests.

- [ ] **Step 7: Commit**: `shared: nine new mahjong maps, four per level`

### Task 9: READMEs and the portfolio

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-31-isoca-play-design.md`
- Other repo `isabellybaldo.github.io`, new branch `isoca-play-card`: modify `src/data/projects.ts`; create `public/thumbs/isoca-play.svg`
- Other repo `isabellybaldo`, new branch `isoca-play-line`: modify `README.md`

**Interfaces:** none.

- [ ] **Step 1: Update isoca-play's docs**

README: tips, the Slots switch, four maps per level, and "The game never says a number is wrong while you play, unless you ask for a tip." In the old design's "No warnings" section, change "no hints" to point at the new spec. Note in the rollback docs that a rollback shows saves on new maps as unplayable until a new game.

- [ ] **Step 2: Add the portfolio card**

Fields: `slug` and `title` `isoca-play`; `accent` `mint`; `thumb` `/thumbs/isoca-play.svg`; `href` `https://github.com/isabellybaldo/isoca-play`; `comingSoon: false`; `tech` `['TypeScript', 'React', 'Python']`. Write `tracks` and `blurb` in the isoca-radar card's deadpan voice, and draw the thumbnail in the same pixel style as `isoca-radar.svg`.

- [ ] **Step 3: Build it**

Run: `npm run build` in `isabellybaldo.github.io`. Expected: succeeds, and `dist/index.html` contains `isoca-play`.

- [ ] **Step 4: Add the profile lines**

A line beneath isoca-radar's in the same style, and isoca-play in "The exceptions". Link to the repo.

- [ ] **Step 5: Commit in each repo**: `docs: tips, no slots and the new maps`, `add the isoca-play card`, `add isoca-play`
