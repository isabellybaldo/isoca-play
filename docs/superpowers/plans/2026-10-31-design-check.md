# Design Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private HTML artifact with the look, draft tiles and both games, playable enough for the owner to react to on their phone.

**Architecture:** A Vite + React frontend in `web/`, with game rules as UI-free TypeScript modules that the real build keeps. This stage has no server, login, saves or offline support. Deals and puzzles are made or stored on the device for now; the later plans move them to the server.

**Tech Stack:** TypeScript ~5.9, React ^19.2, Vite ^8, Vitest ^4, Testing Library, `@fontsource` fonts. Node >=22.12.

**Spec:** `docs/superpowers/specs/2026-10-31-isoca-play-design.md`, with `mahjong-schematics.md` and `sudoku-schematics.md` beside it.

## Global Constraints

- The work stops at the owner's verdict on the artifact. Later plans cover login, saves, deploy and the rest.
- The owner does every git push. Commit locally only.
- Commits carry no Claude co-author trailer.
- Colours come from `cute-trading/web/src/theme.css`: page `#120a1a`, bg `#1b1026`, card `#241532`, bar `#2a1838`, line `#93e1d8`, line2 `#4b3a5c`, fg `#ddfff7`, accent `#ffa69e`, rose `#aa4465`, dim `#b9a6c9`. Fonts: Press Start 2P, VT323, IBM Plex Mono.
- Fonts are self-hosted through `@fontsource`. No request to a third party.
- Sudoku shows no mistake signal before the board is full: no red, no count, no hint, no timer, no same-number highlight, no automatic note removal.
- Mahjong: 4 slots, two clicks to send, a pair leaves right away, a 4th tile with no pair loses, an empty board wins.
- Return has no limit and works on the losing move.
- Tile art and shapes are original, not copied from the reference picture.
- Built for a portrait phone down to 320 px wide, and usable on a computer.

## Review Focus

- A fast double-tap on a phone must select and send, not zoom the page: `touch-action: manipulation`. Pinned in Task 4's CSS test.
- Tapping after a loss or a win must change nothing except through return or new game. Pinned in Task 1 and Task 3.
- Return after a pair left must put both tiles back in the same places, and any face-down tile must turn back over. Pinned in Task 1.
- A sudoku board filled wrong, then corrected through return, must go back to playing and later report won. Pinned in Task 3.
- The biggest layout must fit 320 px without sideways scrolling or tiles under the 34 px wide tap limit. Pinned in Task 2 and Task 5.

---

### Task 1: Project setup and mahjong rules

**Files:**
- Create: `.gitignore`, `LICENSE` (MIT), `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`
- Create: `web/src/mahjong/rules.ts`
- Test: `web/src/mahjong/rules.test.ts`

**Interfaces:**
- Produces:

```ts
export type Tile = { id: number; x: number; y: number; z: number; face: string };
// x and y are in half-tile units: a tile is 2 wide and 2 tall.
export type MahjongState = {
  tiles: Tile[];          // every tile, never mutated
  onBoard: number[];      // ids still on the board
  slots: number[];        // ids in slot order, at most 4
  selected: number | null;
  history: { onBoard: number[]; slots: number[] }[];
  status: 'playing' | 'won' | 'lost';
};
export function newGame(tiles: Tile[]): MahjongState;
export function isCovered(s: MahjongState, id: number): boolean;
export function isFree(s: MahjongState, id: number): boolean;
export function tap(s: MahjongState, id: number): MahjongState;
export function tapElsewhere(s: MahjongState): MahjongState;
export function undo(s: MahjongState): MahjongState;
```

Covered: a board tile at `z + 1` has `|dx| < 2` and `|dy| < 2`. Blocked at a side: a board tile at the same `z` has `dx === -2` (left) or `dx === 2` (right) and `|dy| < 2`. Free: not covered, and at least one side open. Functions return new state and leave the old one unchanged.

- [ ] **Step 1: Set up the project**

Write `web/package.json` by hand with the stack above, `"type": "module"`, and scripts `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`). Set `base: './'` in `vite.config.ts` and a jsdom Vitest environment. `.gitignore` covers `node_modules`, `dist`. Run `npm install` in `web/`.
Expected: exit 0.

- [ ] **Step 2: Write the failing tests**

```ts
const t = (id, x, y, z, face) => ({ id, x, y, z, face });
test('a covered tile is not free, and is freed when the top leaves', () => {
  const s = newGame([t(1,0,0,0,'a'), t(2,0,0,1,'b'), t(3,4,0,0,'a'), t(4,8,0,0,'b')]);
  expect(isCovered(s, 1)).toBe(true);
  expect(isFree(s, 1)).toBe(false);
  expect(isFree(s, 2)).toBe(true);
});
test('half-offset tiles still cover', () => {
  const s = newGame([t(1,0,0,0,'a'), t(2,1,1,1,'a')]);
  expect(isCovered(s, 1)).toBe(true);
});
test('a tile blocked on both sides is not free, one open side is', () => {
  const s = newGame([t(1,0,0,0,'a'), t(2,2,0,0,'b'), t(3,4,0,0,'a'), t(4,0,8,0,'b')]);
  expect(isFree(s, 2)).toBe(false);
  expect(isFree(s, 1)).toBe(true);
});
test('first tap selects, second tap sends', () => {
  let s = newGame(pairRow(['a','b','a','b']));   // pairRow: spaced so all are free
  s = tap(s, 0);
  expect(s.selected).toBe(0);
  expect(s.slots).toEqual([]);
  s = tap(s, 0);
  expect(s.selected).toBe(null);
  expect(s.slots).toEqual([0]);
  expect(s.onBoard).not.toContain(0);
});
test('tapping another free tile moves the selection; a blocked tile does nothing', () => {});
test('tapElsewhere clears the selection', () => {});
test('a pair leaves the slots right away and keeps the order of the rest', () => {
  // send a, b, c then b: slots end as [a, c]
});
test('3 unmatched is fine, a 4th with a pair is fine, a 4th without loses', () => {});
test('an empty board with empty slots wins', () => {});
test('after a loss or a win, tap changes nothing', () => {});
test('undo restores the losing move and returns to playing', () => {});
test('undo after a pair puts both tiles back, and the covered tile is covered again', () => {});
test('undo with no history changes nothing; repeated undo reaches the start', () => {});
```

Fill each empty body with assertions on `slots`, `onBoard`, `selected` and `status`, from the rules in the spec.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --prefix web`
Expected: FAIL, `rules` module not found.

- [ ] **Step 4: Implement `web/src/mahjong/rules.ts`**

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --prefix web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .gitignore LICENSE web
git commit -m "mahjong: the rules, with two taps, four slots and unlimited return"
```

### Task 2: Mahjong shapes and winnable deals

**Files:**
- Create: `web/src/mahjong/layouts.ts`, `web/src/mahjong/deal.ts`
- Test: `web/src/mahjong/layouts.test.ts`, `web/src/mahjong/deal.test.ts`

**Interfaces:**
- Consumes: `Tile`, `isFree`, `newGame`, `tap` from Task 1.
- Produces:

```ts
export type Level = 'easy' | 'medium' | 'hard';
export type Layout = { id: string; name: string; level: Level; cells: { x: number; y: number; z: number }[] };
export const LAYOUTS: Layout[];   // ids: 'frame' easy, 'trophy' medium, 'fort' hard
export function layoutsFor(level: Level): Layout[];
export const FACES: string[];     // 18 ids, drawn in Task 4
export function makeDeal(layout: Layout, seed: number): Tile[];
```

Author `cells` from ASCII rows per layer, for readability. Targets: frame about 36 tiles on 1 layer, trophy about 56 on 3 layers, fort about 72 on 4 layers.

- [ ] **Step 1: Write the failing tests**

```ts
test.each(LAYOUTS)('$id fits a portrait phone and has an even tile count', (l) => {
  expect(l.cells.length % 2).toBe(0);
  const xs = l.cells.map(c => c.x), ys = l.cells.map(c => c.y);
  expect(Math.max(...xs) - Math.min(...xs) + 2).toBeLessThanOrEqual(16); // 8 tiles wide
  expect(Math.max(...ys) - Math.min(...ys) + 2).toBeLessThanOrEqual(20); // 10 tiles tall
  expect(new Set(l.cells.map(c => `${c.x},${c.y},${c.z}`)).size).toBe(l.cells.length);
});
test('each level has one shape, and harder shapes stack higher', () => {
  const top = (id) => Math.max(...LAYOUTS.find(l => l.id === id).cells.map(c => c.z));
  expect(top('frame')).toBeLessThan(top('trophy'));
  expect(top('trophy')).toBeLessThan(top('fort'));
});
test.each(LAYOUTS)('$id deals are winnable under the slot rule', (l) => {
  for (let seed = 1; seed <= 200; seed++) {
    expect(canWin(makeDeal(l, seed))).toBe(true);
  }
});
test('same seed gives the same deal, different seeds differ', () => {});
test('every face appears an even number of times', () => {});
```

`canWin` is a test helper: a depth-first search with memoised `onBoard` + `slots` states over `tap` twice per move.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --prefix web`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both files**

`makeDeal`, using a seeded mulberry32 generator: start with all cells on the board, repeatedly pick two distinct free cells at random, give them the next face from a shuffled list, and remove them. If fewer than two are free, restart with the next internal seed. The removal order is then a winning play that never holds more than one tile. Difficulty beyond the shape is tuned in a later plan.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --prefix web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/mahjong
git commit -m "mahjong: one shape per level, and deals that can always be won"
```

### Task 3: Sudoku rules and starter puzzles

**Files:**
- Create: `web/src/sudoku/rules.ts`, `web/src/sudoku/puzzles.ts`
- Test: `web/src/sudoku/rules.test.ts`, `web/src/sudoku/puzzles.test.ts`

**Interfaces:**
- Consumes: `Level` from Task 2.
- Produces:

```ts
export type Puzzle = { level: Level; givens: string; solution: string }; // 81 chars, '.' is empty in givens
export const PUZZLES: Puzzle[];  // 3 per level
export type SudokuState = {
  puzzle: Puzzle;
  values: number[];   // 81, 0 is empty
  notes: number[];    // 81 bitmasks, bit d-1 is digit d
  selected: number | null;
  mode: 'write' | 'notes';
  history: { cell: number; value: number; notes: number }[];
  status: 'playing' | 'won' | 'unsolved';
};
export function newSudoku(p: Puzzle): SudokuState;
export function selectCell(s: SudokuState, cell: number): SudokuState;
export function setMode(s: SudokuState, mode: 'write' | 'notes'): SudokuState;
export function pressDigit(s: SudokuState, d: number): SudokuState;
export function undo(s: SudokuState): SudokuState;
```

Rules: givens never change. In write mode a digit replaces the cell's value and clears its notes, and pressing the cell's current digit erases it. In notes mode a digit toggles on an empty cell and does nothing on a filled one. Status is `playing` until no cell is empty, then `won` or `unsolved`. When status is `won`, `pressDigit` does nothing. `unsolved` allows further edits, as a full board can be overwritten.

- [ ] **Step 1: Write the failing tests**

```ts
test('notes toggle and write replaces them', () => {});
test('givens cannot change in either mode', () => {});
test('pressing the same digit erases the value', () => {});
test('a wrong digit changes nothing but the value while the board has gaps', () => {
  // status stays 'playing' with a wrong digit placed
});
test('full and wrong reports unsolved; undo returns to playing; fixing it wins', () => {});
test('undo restores the value and notes of one change; no history is a no-op', () => {});
test('after a win, pressDigit changes nothing', () => {});
test('the state has no field naming mistakes or conflicts', () => {
  expect(Object.keys(newSudoku(PUZZLES[0])).sort()).toEqual(
    ['history','mode','notes','puzzle','selected','status','values']);
});
// puzzles.test.ts
test.each(PUZZLES)('$level puzzle has one solution and matches it', (p) => {
  expect(countSolutions(p.givens, 2)).toBe(1);
  expect(solve(p.givens)).toBe(p.solution);
});
test('harder levels give fewer numbers on average', () => {});
```

`countSolutions` and `solve` are a backtracking test helper. Grading by technique comes with the server generator in a later plan.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --prefix web`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `rules.ts` and write `puzzles.ts`**

The puzzles are original. Produce them with a throwaway local script (fill a grid, remove cells while the solution stays unique), and commit only the data.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --prefix web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/sudoku
git commit -m "sudoku: the rules, with notes, return and no mistake signals"
```

### Task 4: Theme, draft tiles and home page

**Files:**
- Create: `web/src/theme.css`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/Home.tsx`, `web/src/mahjong/TileArt.tsx`
- Test: `web/src/theme.test.ts`, `web/src/App.test.tsx`, `web/src/mahjong/TileArt.test.tsx`

**Interfaces:**
- Consumes: `FACES` from Task 2.
- Produces: `type Screen = 'home' | 'mahjong' | 'sudoku'`, held in `App` state (no router, no hash paths); `<TileArt face={string} />`, a crisp inline SVG built from a 16x16 pixel grid with `shape-rendering="crispEdges"`; CSS variables named as in Global Constraints. The `frontend-design:frontend-design` skill guides the look. Draw on the owner's style: thick borders, hard offset shadows, cute pixel subjects such as a cat, sun, star, moon and heart.

- [ ] **Step 1: Write the failing tests**

```ts
test('the theme stops double-tap zoom and sets the palette', () => {
  const css = readFileSync('src/theme.css', 'utf8');
  expect(css).toMatch(/touch-action:\s*manipulation/);
  expect(css).toContain('#93e1d8');
  expect(css).not.toMatch(/https?:\/\//);          // nothing from third parties
});
test('home opens each game and comes back', async () => {});
test.each(FACES)('%s has its own art', (face) => {});  // all 18 render distinct SVG markup
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --prefix web`
Expected: FAIL.

- [ ] **Step 3: Implement the theme, shell, home page and 18 tiles**

Add `@fontsource/press-start-2p`, `@fontsource/vt323` and `@fontsource/ibm-plex-mono`, imported in `main.tsx`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --prefix web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "web: the pixel theme, draft tiles and home page"
```

### Task 5: Mahjong screens

**Files:**
- Create: `web/src/mahjong/MahjongSetup.tsx`, `web/src/mahjong/MahjongGame.tsx`, `web/src/mahjong/mahjong.css`, `web/src/mahjong/boardSize.ts`
- Modify: `web/src/App.tsx`
- Test: `web/src/mahjong/MahjongGame.test.tsx`, `web/src/mahjong/boardSize.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2 and 4.
- Produces: `tileWidth(layout: Layout, viewportWidth: number): number`, the largest whole pixel width that fits the viewport with 16 px of side padding.

The screens follow the drawings in `mahjong-schematics.md`: a difficulty row, that level's type list with random, then slots, board, return and new game. Tiles are absolutely positioned buttons. Upper layers are offset a little to show depth. Covered tiles are face down, and face-up tiles blocked at both sides are dimmed. The end of a game shows won or lost, with return and new game.

- [ ] **Step 1: Write the failing tests**

```ts
test.each(LAYOUTS)('$id tiles are at least 34 px wide at 320 px', (l) => {
  expect(tileWidth(l, 320)).toBeGreaterThanOrEqual(34);
});
test('picking a level lists only its types, and random picks from that list', async () => {});
test('a covered tile shows no face', async () => {});
test('two taps send a tile to a slot; one tap only selects', async () => {});
test('a losing send shows lost, and return takes it back', async () => {});
test('clearing the board shows won', async () => {});
```

If the 34 px test fails for a shape, narrow the shape in `layouts.ts`; do not lower the limit.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --prefix web`
Expected: FAIL.

- [ ] **Step 3: Implement the screens and `tileWidth`**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --prefix web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "mahjong: the setup and game screens"
```

### Task 6: Sudoku screen

**Files:**
- Create: `web/src/sudoku/SudokuGame.tsx`, `web/src/sudoku/sudoku.css`
- Modify: `web/src/App.tsx`
- Test: `web/src/sudoku/SudokuGame.test.tsx`

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces: `<SudokuGame />`, which starts with a level choice, then follows `sudoku-schematics.md`.

Givens and written numbers look different from each other, in the same colour family: no styling may depend on whether a number is right. The selected square is the only highlight.

- [ ] **Step 1: Write the failing tests**

```ts
test('notes mode shows small numbers; write mode replaces them with one big one', async () => {});
test('a wrong digit renders the same as a right digit', async () => {
  // place the right digit in one cell and a wrong one in another, then compare className
});
test('a full wrong board says not solved and does not mark any square', async () => {});
test('a full right board says won', async () => {});
test('return works from the not solved message', async () => {});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --prefix web`
Expected: FAIL.

- [ ] **Step 3: Implement the screen**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --prefix web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "sudoku: the game screen"
```

### Task 7: Publish the design check

**Files:**
- Modify only what the checks below turn up.

- [ ] **Step 1: Build**

Run: `npm run build --prefix web`
Expected: exit 0, with `web/dist/index.html` and assets that use relative paths.

- [ ] **Step 2: Check it in a browser at phone size**

Run the built page locally at 320x568 and 390x844. Play a mahjong game to a win and a loss, and a sudoku through notes, write and return.
Expected: no sideways scrolling, no failed requests, and no requests to other hosts.

- [ ] **Step 3: Publish**

Use `mcp__claude-artifacts__publish_files`, title "isoca-play design check", icon "game". Send `web/dist/index.html` and every asset, with `as` matching its relative path. It stays private to the owner.
Expected: the result carries a url.

- [ ] **Step 4: Open it and check the published page**

Fonts and the game must work under the artifact's content policy. If fonts are blocked, inline them as data URIs and republish.

- [ ] **Step 5: Stop and give the owner the link**

Report what was checked and how. Wait for the owner's verdict. Do not start the login, saves or deploy.
