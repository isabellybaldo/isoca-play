# Tips, more maps, no-slots mahjong, and Keep playing

Date: 2026-11-01. Marks: **(owner)** was said or approved by the owner; **(call)** was
decided while writing this and can be overruled. Read with
`2026-10-31-isoca-play-design.md`, which this changes only where it says so.

## Why

The owner plays both games a lot on their phone. They get stuck on sudoku and want to
learn the named moves rather than just be handed a digit. Mahjong has one map per level,
so it repeats. The four slots are sometimes unwanted. "Keep playing" strands them on the
setup screen. The project should also appear in their portfolio.

## Goals

1. Tips on request, in sudoku and mahjong.
2. Four maps per difficulty in mahjong: nine new ones.
3. An option to play mahjong without the four slots.
4. "Keep playing" returns to the board, in both games.
5. isoca-play listed in the portfolio and the READMEs.

## Non-goals and anti-goals

- Nothing warns unprompted. The rule "no red numbers, no mistake count, no timer" stands;
  only "no hints" changes, and only to "no hints unless tapped" **(owner)**.
- A tip never changes the game: no digit written, no note changed, no move counted, no
  entry in Return, nothing saved **(owner for the tap; call for the rest)**.
- It is a failure if a tip is wrong, gets stuck repeating itself, reveals a face-down
  mahjong tile, or breaks a game already saved on the server.
- No tip counter or penalty **(call)**.

## Sudoku tips

**Button.** A Tip button in the game's controls, next to Return. Disabled once the game is
won. Works offline: everything is computed in the browser from the saved state **(call)**.

**Wrong numbers come first (owner).** If any written number differs from
`puzzle.solution`, the tip highlights every wrong number at once, says to fix those first,
and gives no move. This includes a full board reporting "Not solved".

**Otherwise, the next move and why (owner).** A tip names the move, draws it on the board
and explains it in one or two plain lines under the board. For example: "Hidden Single: in
this box, 7 only fits here."

**A tip always leads to a number (call).** The board stores only written digits, and tips
ignore the player's notes. So a move that only rules numbers out would change nothing, and
tapping Tip again would show the same move forever. So a tip is a short chain:

- Start from the written digits and work out the possibilities.
- Apply the techniques simplest first, in the grader's order, until one places a digit.
- Show the first step. A Next button walks each step, each drawn and explained, for
  example "XY-Wing: these squares can't be 4, because…". The last step is the square and
  its number. A Close button leaves at any point.
- A plain single is a one-step chain.

Writing the number and tapping Tip again gets the next chain. The player's notes are
never read or changed, so the tip works with none and is unaffected by wrong ones.

**Moves.** The ten in `tools/sudoku_grader.py`: Naked Single, Hidden Single, Locked
Candidates, Naked Pair, Hidden Pair, Naked Triple, Hidden Triple, X-Wing, XY-Wing,
Swordfish. Each step reports the technique, the cells that prove it, what it removes or
places, and the unit it applies to. Explanations use rows, columns and boxes, in the
game's existing plain voice.

**Implementation constraint.** The grader stays out of the server and is Python, so the
engine is a TypeScript port in `web/src/sudoku/`, like `rules.ts`. It must be proved
against the grader: over the whole of `server/isoca_play/data/sudoku_pack.json`, starting
from the givens, repeatedly applying tips finishes every board at its `solution`, every
placed digit matches, and the technique order agrees with the Python grader, using a
shared fixture in the manner of `shared/rule-cases.json`.

**Highlight.** Transient view state in the Game component, not in `SudokuState`, so the
save format and `MOVED` do not change. Any change to the board clears the tip **(call)**.

## Mahjong tips

The owner said tips are "specially" for sudoku and has not described the mahjong one, so
this is all **(call)**. It uses only what the player can already see. Solving from hidden
faces would reveal face-down tiles, so a tip does not promise the board stays winnable.

A Tip button sits with Return and New game. Disabled unless playing. First match wins:

1. With slots, a tile in a slot has a free match on the board: highlight it. "This pairs
   with the cherry in your slots."
2. Two free tiles match: highlight both. "Both are open and they match."
3. With slots, no pair is open: highlight the free tile whose removal uncovers or frees
   the most tiles, and explain that. If 3 slots are full, say that a fourth tile with no
   pair loses, so Return may be better.

Same transient rule as sudoku: the highlight is not saved, and any move clears it.

## No-slots mahjong

**Rules (owner).** Tap one open tile, then its match, and both leave. Game over when no
open pair is left. Return still takes back the last move, as after a slots loss.

**Details (call).**
- Tapping a free tile that doesn't match moves the selection to it. Tapping the selected
  tile again deselects it. Tapping elsewhere deselects, as now.
- A removed pair is one move and one Return. "Open" means `isFree`, and matching means
  `matchKey`: any season with any season, any flower with any flower.
- After each removal: empty board is won, else no free pair is lost. The end note has its
  own line: "No open pair left. Return takes the last move back."
- The slots row is hidden, and `GAME_CHROME` must not reserve its height then, so the
  board can grow.

**Choosing it (call).** A Slots on/off switch on the setup screen, on by default. It applies
to games started from there, and New game inside a game keeps that game's mode. A game
cannot change mode once started. The setting is remembered on the device, and the Resume
button says "no slots" when the held game has none.

**Saves.** Add optional `noSlots?: boolean` to `MahjongState`, absent meaning slots, so
saves already on the server still load as they are. `undo` restores status as now.

**Winnability.** The server's deal already removes two free tiles at a time, so playing in
that order wins without slots too. `make_deal` does not change. A test states this.

## More maps

Four per difficulty **(owner)**, with Random and the picker working as now:

| Level | Tiles, layers | Existing | New |
|---|---|---|---|
| Easy | about 42, 2 | Frame | Heart, Cat face, Cherry |
| Medium | about 62, 3 | Trophy | Butterfly, Panda, Crescent moon |
| Hard | about 72, 4 | Fort | Rose, Frog, Castle gate |

- Same grid limits as today: 8 columns by 9 rows at most, an even tile count, at most 36
  pairs, and the overlap rules in `layouts.test.ts`. "About" means the shape may move a
  few tiles from its level's count, but stays within the level's layers **(call)**.
- The shapes go in `shared/layouts.json`, copied to `server/isoca_play/shared/`.
  `layouts.test.ts` and `server/tests/test_mahjong.py` pin exactly three maps and must
  change. Every map must deal reliably under `MAX_ATTEMPTS`, tested many times per map.
- The setup screen must stay usable on the owner's phone with four maps per level.
- **Approval before the game (owner's standing rule).** Visual changes are shown first:
  draw all nine in a private artifact, using the setup screen's stack colours, and wait for
  the owner's reaction before they ship. A shape that looks wrong is redrawn; a past
  lotus was rejected for looking like a middle finger, so check each shape for that too.

## Keep playing

**Fix (owner).** In both setup screens' "Start a new game?" dialogs (`SudokuGame.tsx`, and
`Mahjong` in `App.tsx`), "Keep playing" closes the dialog and opens the held game. In
mahjong it also sets the level to the held game's, as Resume does. If there is no
readable game (`unplayable`, `game` null) it only closes the dialog, because nothing can be
returned to. The dialogs inside a game already stay on the board. Cover both with tests.

## Portfolio and READMEs

All **(call)** except that these are wanted **(owner)**.

- `isabellybaldo.github.io`: a second entry in `src/data/projects.ts`, with a new pixel
  thumbnail in `public/thumbs/` and an href to `github.com/isabellybaldo/isoca-play`,
  because the site itself is behind a login. Same deadpan voice as the isoca-radar card.
- Profile `isabellybaldo/README.md`: one line beside isoca-radar, and the repo added to
  "The exceptions".
- `isoca-play/README.md`: tips, no-slots, the new maps. Its statement that the game never
  says a number is wrong must become "unless you ask for a tip".
- Also update the "no hints" line in `2026-10-31-isoca-play-design.md` to point here.

## Constraints

- Public repos: nothing added may depend on secrecy. `isoca-play` works by PR only.
- The owner does every git push, and commits carry no Claude co-author line.
- Mobile first: Android phone. iOS Safari doesn't matter.
- Existing saves must keep loading. `isPlayableMahjong` ignores unknown fields; do not
  tighten it in a way that refuses saves without `noSlots`.
- No new runtime dependencies, and nothing new leaves the browser.
- Existing CI, tests and CSP stay green; the offline e2e must still pass.

## Left to the builder

Component structure, the exact wording of explanations, the look of highlights within the
existing pixel theme, the fixture format, and the order of work. The Hard-tuning and
deploy-key items in the project's open list are separate and out of scope.
