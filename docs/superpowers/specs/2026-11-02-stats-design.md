# Stats

## Why

The owner wants to see how they play and whether the games need tuning: is 144-tile mahjong
really hard, which maps get played, which levels get abandoned. Nothing about past games is kept
today; a save holds only the current game of each kind.

There is one account, so every recorded game is the owner's. Other people will see the totals
too: the owner wants them on the login page, where anyone can read them without a password.

## Goals

- One record per finished game, kept on the server, covering every device.
- A stats screen inside the app, opened from the home page.
- The same totals on the login page, public, with no dates or times.

## Non-goals

- Filling in past games. Counting starts when this ships.
- Recording each tap or move.
- Sign-up, other players, leaderboards.
- Charts. Numbers and simple lists are enough for now.

## Anti-goals: this has failed if

- A date, clock time or game-by-game list can be read without signing in.
- Anyone without a session can add, change or delete a record.
- A timer or a count appears on a game screen, or play feels any different.
- A problem with stats can stop a game being played or saved.
- A login page failure in the stats takes the password box with it.

## What counts as a game

- **Starts:** when the player makes the first move. A game dealt and replaced with no moves is not
  a game. (Builder's call how a move is detected; `history.length > 0` is what the games use now.)
- **Won:** recorded the moment the game first reaches `won`. A Return after that changes nothing
  in the record, and later play on that board is not counted.
- **Lost (mahjong only):** recorded when a game whose status is `lost` is replaced. A player who
  gets stuck, uses Return and goes on to win has a win, not a loss.
- **Abandoned:** recorded when a game with moves that is neither won nor lost is replaced by a new
  one, including through the "start a new game" prompt and the crash screen's new game. Leaving and
  coming back later is the same game.
- **Not recorded:** a game already under way when this ships, and a save the app finds unplayable.
  They have no counters to report.

## What a record holds

All games:

| Field | Note |
|---|---|
| id | Made on the device when the game starts, so sending twice stores once |
| game | mahjong, sudoku or solitaire |
| level | easy, medium or hard; solitaire has none |
| result | won, lost or abandoned |
| day | The device's local date when it ended, with no clock time |
| days played | Each local date on which a move was made in this game, kept with the counters |
| seconds | Time on the game screen only, see below |
| returns | Times Return was used |
| tips | Times Tip was asked for |

Per game:

- **Mahjong:** map id, slots on or off, moves.
- **Sudoku:** how many times the board was filled in and came out "Not solved".
- **Solitaire:** how many times the draw pile was turned over.

Counters ride inside the saved game as a new field, so they move between devices with it and
survive a reload. Unknown fields are already welcome in a save. Return must be counted explicitly,
because undo shortens `history`. A save with no such field is a game from before this shipped.

## Time

Time counts only while a game screen is showing and the page is visible, so a game left open
overnight doesn't count as 8 hours.

Time reaches the save only along with a real move; no save is ever sent for time alone. Saves work
as "last save wins", so a time-only save from an idle device could erase moves made on another, and
it would also trouble the save marker. The cost is accepted: a lost or abandoned game loses the
stretch after its last move. A win is exact, because the winning move carries its time.

## Sending records

A finished record is kept on the device in a small outbox and sent to the server, then removed once
the server confirms it. This covers offline play and a closed page. The server ignores an id it
already has. A failure to send is silent and retried on the next load: the save marker and the
game screens stay out of it. Logging out tries to send the outbox and doesn't wait long for it, as
stats aren't worth holding up a log out; clearing the device loses what's left.

## Numbers shown

**Public, on the login page, and in the app:**
- Per game: games played, wins, win rate.
- Mahjong: plays and win rate per map, and how often it was lost and abandoned.
- Plays per difficulty, per game.
- Average and best time to win, per game and level, and per mahjong map. Only wins count, so a game
  given up after 5 seconds is never the best time. A map never won shows a dash.
- Average returns and tips per game.
- Longest streak of days played, as a number only.

Win rate counts wins out of all recorded games, abandoned ones included.

**In the app only, as these involve dates:**
- Games finished per day over the last 30 days, using `day`.
- Current streak.

A streak counts the days in `days played`, so a sudoku played across three days counts for all
three, and a game lost on Monday and replaced on Friday counts for Monday. A game still under way
has no record yet, so its days join the streak once it ends.

A number built from nothing (an average of no games) shows as a dash, never as zero.

## Login page

- The stats sit below the form, and the password box stays the first thing on the page.
- They are put into the page on the server, like the existing `<!--message-->`. The page gets no
  script and no public data route, and `PUBLIC_PATHS` in `auth.py` doesn't grow.
- With no records yet, the section isn't there at all.
- If the stats can't be read, the login page is served without them and the error is logged.
- A narrow phone can read it: lists stack and nothing scrolls sideways. It uses the existing login
  look (`login.css`).

Accepted: someone reloading the login page repeatedly could tell when the owner finishes a game by
watching the numbers change. The owner chose public totals, and this is small.

## App

- A Stats button on the home page opens a stats screen, using the existing theme and pixel look.
- Offline it says it needs a connection; it isn't kept on the device.
- The service worker keeps treating this route as it does any other server answer. It must not end
  up in the saves cache.

## Server

- A new table through a new appended migration in `db.py`; shipped migrations are never edited.
- Sending records needs a session and passes the Origin check, both from the existing guard.
- Each field is checked for kind and range, and the body stays small. A record that fails is
  refused and dropped from the outbox, so one bad record can't block the rest.
- The numbers are worked out on request from the records. There are few enough for that.
- A test proves the public section contains no date, and that no route gives the records out
  without a session.

## Left to the builder

- Screen layout and wording, within the existing look. The owner doesn't need mockups.
- Route names, table shape, and how the outbox is stored on the device.
- How often time is written into the save.
- Which order the sections appear in.
