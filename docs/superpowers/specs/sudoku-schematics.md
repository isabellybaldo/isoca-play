# Sudoku: quick schematics

`[guess]` marks anything you didn't say.

## 1. The screen (phone)

```
+-------------------------------+
|  back      difficulty: hard   |  <- [guess] top bar
|                               |
|  +---------+---------+-----+  |
|  | 5 .  .  | 1 2     | ... |  |  <- 5 came with the puzzle
|  |         | 3       |     |  |  <- small 1 2 3 are your notes
|  | .  7  . | .  .  9 | ... |  |  <- 7 and 9: printed or written
|  +---------+---------+-----+  |
|  | ...     | ...     | ... |  |
|  +---------+---------+-----+  |
|                               |
|  [ write | notes ]            |  <- [guess] switch between the two
|  [1][2][3][4][5][6][7][8][9]  |
|  [return]                     |
+-------------------------------+
```

## 2. Notes and writing

```
mode: notes    tap square, tap 1, tap 2, tap 3     small   1 2 3
               tap 2 again                         small   1   3   [guess] removes it

mode: write    tap square, tap 7                   big     7       [guess] replaces the notes
```

## 3. No warnings

```
row: 4 . . 4 . . . . .      two 4s in one row

other apps    4 turns red, mistake counted
this game     nothing happens, you carry on
```

## 4. How a game ends

```
          write numbers
                |
                v
           board full? --no--> keep playing
                |
               yes
                |
         every number right?
           |            |
          yes           no
           |            |
          WIN        NOT SOLVED   [guess] says so, not where
                        |
                     [return] and keep trying, or new game
```

## 5. Difficulty

```
easy     many numbers given    the simple rules are enough
hard     few numbers given     needs the harder sudoku rules
```

[guess] Every puzzle has exactly one solution and can be solved by logic alone,
with no guessing needed.
