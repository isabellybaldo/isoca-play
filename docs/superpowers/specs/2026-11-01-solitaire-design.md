# Solitaire

Date: 2026-11-01. Status: approved by the owner 2026-11-01. Marks: **(owner)** was said or approved by the owner; **(call)** was
decided while writing this and can be overruled. Read with
`2026-10-31-isoca-play-design.md` and `2026-11-01-tips-maps-no-slots-design.md`. Their
login, saves, offline, deploy and process rules apply here unless this says otherwise.

## Why

The owner plays on their phone and wants classic solitaire in their game library, beside
sudoku and mahjong, in the same pixel look. **(owner)**

Success: the owner opens it on their Android phone, plays with double taps and drags
without misfires, carries on where they left off, and always knows a win was possible.

## Goals

- Klondike with one card turned from the pile at a time. **(owner)**
- Every deal can be won. **(owner)**
- Double tap sends a card to the answer piles. Dragging builds or continues a sequence.
  **(owner)**
- The approved cards: ivory faces and the moon and stars back. **(owner)**

## Non-goals

All **(owner approved)** in the playback of 2026-11-01:

- Score, timer, move count, stats, sound.
- Difficulty levels or any choice before a game. New game gives a winnable deal.
- Draw three, limits on passes through the pile, or other rule settings.
- A choice of card face or back. Only the approved pair ships. **(call)**
- Auto-finish. The player sends the last cards up themselves. **(call)**

## Anti-goals

- A stray tap or a mistaken drag changes the game. An invalid move changes nothing.
- A deal that cannot be won reaches the player.
- The game announces that the player is stuck, or warns before being asked.
- A tip reveals a face-down card, or relies on the pile's unseen order.
- Dragging scrolls or zooms the page, or a double tap zooms it.

## Rules (owner approved)

**Setup.** 28 cards in seven columns of 1 to 7, the top card of each face up. The other 24
form the pile.

**Pile.** Tapping the pile turns one card onto the face-up pile beside it. Tapping the
empty pile turns all of those back over, in their original order. No limit on passes.

**Columns.** A card goes on a card one rank higher of the other colour. Only a king, or a
run headed by a king, starts an empty column. Any run of face-up cards that follows these
rules moves together. A face-down card turns over as soon as it is uncovered, as part of
the move that uncovered it.

**Answer piles.** One per suit, ace up to king. The top card of an answer pile may be
dragged back onto a column under the column rules.

**Double tap.** On the top card of a column or the top face-up pile card: if that card can
go on its answer pile, it goes. Otherwise nothing happens. A double tap on any other card
does nothing. A double tap never moves a card to a column. **(call for the last two)**

**Drag.** From a face-up card, its run comes with it. Released over a place the move is
valid, it lands. Anywhere else it snaps back. Dragging a single card onto an answer pile is
also valid. **(call for the last sentence)**

**Return.** Takes back one move with no limit, to the start of the game. A pile tap and a
pile turn-over are each one move. Returning a move that turned a card over turns it face
down again.

**End.** All 52 cards on the answer piles is a win, with a short note and New game. Being
stuck is never announced. Return and New game remain available.

## Winnable deals

Generate ahead of time in a pack, as sudoku does: `tools/make_solitaire_pack.py` writes
`server/isoca_play/data/solitaire_pack.json`, with a fixed seed.

- Shuffle, then ask a solver for a win under exactly these rules. Keep the deal only with a
  win found. A deal the solver cannot settle is discarded, not assumed. **(call)** Mahjong's
  build-backwards method is not used.
- Each entry holds the deal and its winning move list. **Proof is by replay:** a test plays
  every entry's moves through the project's own rules and must reach a win. The solver is
  trusted for nothing, and CI never needs to install it. **(call)**
- 500 deals, no repeats. **(call)** The owner plays a lot, so this can grow.
- Try `tcdude/py-klondike-solver` first, a Python wrapper (MIT) around
  `ShootMe/Klondike-Solver` (MIT, archived). Only READMEs have been read, so confirm it
  installs, handles draw one with unlimited passes, and gives moves that can be converted.
  If not, use the C++ solver directly, `ShootMe/MinimalKlondike` (MIT), or a small search
  of our own. It is a tool-only dependency, in `tools/requirements.txt`, never in the server
  or image.

`POST /api/new/solitaire` takes an optional `{"not": <deal on screen>}`, as sudoku does, so
New game always changes the deal. It returns the deal and leaves out the move list, so a
save holds no solution. **(call)** Requires the session and Origin checks like its siblings.

A game is won only by the player's own play: nothing guarantees the position stays winnable
after their moves, and Return is the way back.

## Cards

The approved art is in the private artifact "Solitaire card designs"
(`https://claude.ai/artifact/LDPziGJ788Sw5R9E9P8Wfb`), version `1793571029-8f4c`. **Port its sprite
data and drawing as they are**, face `ivory` and back `stars`. The owner's own login sees
it; a builder without access gets the draft from the owner. It is private to the owner, so
the drawing data must be committed as code. All the art is original.

- A card is one 16 x 24 sprite: dark outline, cut corners, ivory face, rose bottom edge.
  Rank and small suit in the top 10 rows, a big suit below. Aces have a face. Jack is a frog,
  queen a bunny, king a cat with a crown.
- Red suits `#d93a4e`, black suits `#2a1838`.
- Whole-number scales only. On phones of 356 px or wider: 3x, 48 x 72 px. Narrower: 2x,
  32 x 48 px, though each tap area stays the column's full width. Larger on a computer as
  the table fits. **(call)**
- Empty answer piles are a dotted outline with a dim suit, as in the artifact.

The owner's standing rule that visual changes are shown first is met for the cards. The
screen itself follows the artifact's "On the table" layout: pile, face-up pile, a gap, four
answer piles, then seven columns. Fine details are checked on the phone after the build.
**(call)**

## Table layout

- Face-down cards overlap to show their top 4 sprite rows, and face-up cards their top 10.
- A column that would run off the screen tightens its overlap, face-down cards first, and
  must keep rank and suit readable. **The page does not scroll during play**, so a drag can
  never scroll it. Worst case to test: 6 face-down and 13 face-up cards, at 320 x 568 and
  on a typical Android phone. **(call)**
- **If 3x can't fit the height, cards drop to 2x. (call)** This overrides the width rule above,
  as mahjong falls back to 36 px. Readable rank and suit and no scrolling always win over
  card size. The scale is chosen from the screen, not the column, so it doesn't change
  during a game unless the screen does, and room for the tip line is always reserved.
- Return, Tip, New game and Back sit with the other games' controls, and use the same style.

## Tips

A Tip button, on request only, as in the other games. It highlights a move and explains it
in one plain line. Tips are worked out in the browser and work offline. All **(call)**,
following the mahjong tip's approach of using only what the player can see: face-up cards
and the fact that the pile has cards in it.

First match wins:

1. A move that turns over a face-down card.
2. A move onto an answer pile that cannot hurt: the card's rank is at most one above the
   lowest top rank of the two opposite-colour answer piles (aces and twos always qualify).
3. A king into an empty column when one is available, and it uncovers something.
4. Any other move from the face-up pile onto a column or answer pile.
5. Turn the next pile card.
6. If a whole pass through the pile has happened since the last move other than a pile tap
   or turn-over, say that no move stands out and that Return can back up.

Rule 5 and rule 6 together stop a tip repeating forever. A tip does not promise the game
stays winnable. As in mahjong, the highlight is not saved, any move clears it, and a tip
never changes the game, enters Return, or counts for anything. Tip is disabled after a win.

## Saves and offline

- One solitaire save, replaced by a new game after one confirming tap, like the others.
  Add `solitaire` to `GAMES` in `server/isoca_play/saves.py` and `web/public/sw.js`.
- **Return history must fit the 512 KB save limit in the longest game:** pile passes make
  long games, so store moves or small changes, not a full copy per move. Test a game far
  longer than a human would play; if it could still exceed the limit, the builder must
  shrink the format, not drop history. **(call)**
- **No setup screen. (call)** Tapping Solitaire on the home page opens the table: the saved
  game if there is one, otherwise a new deal with no confirming tap. Back goes home. So
  there is no `Resume` button, and `Keep playing` exists only in the in-game New game dialog.
- With no readable save and no connection, or a save this release can't read, the screen
  shows a short note and Back, in the wording style of the other games; a readable
  connection replaces an unreadable save with a new deal only after one confirming tap.
  **(call)**
- The save marker, the offline rules and the disabled New game work as in the other games.
- The save check tolerates unknown fields, so later additions don't refuse old saves.

## Home page

A third game card with a small heap of the approved cards and one short line in the
existing voice, such as "Stack them down, send them home." The grid must look right with
three cards on phone and computer. **(call)**

The card heap and three-card grid are a visual change no one has seen: show them in a
private artifact and wait for the owner's reaction before they ship. **(call)**

## Tests

- The rules live in plain TypeScript in `web/src/solitaire/`, as with the other games. The
  Python replay used on the pack shares cases with them, in the manner of
  `shared/rule-cases.json`, so the two cannot drift.
- Rule tests cover every Rules section above, including Return across a turned-over card, a
  pile turn-over and a move from an answer pile.
- Interaction tests cover a double tap, a drag that lands, a drag that snaps back, and a
  double tap that does nothing. The offline e2e covers solitaire.
- Tips: rules 1 to 6 each tested, and playing tips never loops without saying so.

## Constraints

- Mobile first: an Android phone. Use pointer events, with mouse working too.
- No new runtime dependencies in the server or web app, and no requests to third parties.
- Existing saves and tests stay green. Solitaire is additive. A rollback past this release
  simply leaves the new save unused.
- Public repo. The owner does every git push and PR merge, and commits carry no Claude
  co-author line.
- Open source code may be read for reference. Only MIT or similar may be reused, with
  attribution. `ckonig/solitaire`, `mmendesas/solitaire` (no licence shown) and the Phaser
  pack are not to be copied from. `Ze3PeO/react-solitaire` (MIT, React and Vite) is the
  nearest reference.
- Update `README.md` to mention solitaire. The portfolio entry is out of scope.

## Left to the builder

Component structure, the state format within the save rule, the drag threshold and double
tap timing, the fine layout of controls, exact wording, the pack file format, and the order
of work.
