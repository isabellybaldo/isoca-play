# Mahjong: quick schematics

`[guess]` marks anything you didn't say.

## 0. Setting up a game

A type is a specific setup, and each one belongs to one difficulty.

```
+-----------------------------+
|  [ easy ] [ medium ] [=hard=]  <- pick the difficulty first
|                             |
|  HARD TYPES        [random] |  <- random picks from this list
|  +-------+ +-------+        |
|  | [   ] | |  \_/  |        |
|  | frame | | trophy|        |
|  +-------+ +-------+        |
|  +-------+ +-------+        |
|  |  (@)  | | [] [] |        |
|  |nautil.| |  fort |        |
|  +-------+ +-------+        |
|                             |
|  tap a type to start        |
+-----------------------------+

easy     flat shapes, many tiles free
medium   some stacking
hard     tall, tight stacks, few tiles free
```

## 1. The screen (phone)

```
+-----------------------------+
|  back          moves: 12    |  <- [guess] top bar
|                             |
|  SLOTS                      |
|  +-----+-----+-----+-----+  |
|  | cat | sun |     |     |  |  <- your 4 slots
|  +-----+-----+-----+-----+  |
|                             |
|  BOARD                      |
|       +-----+-----+         |
|       | ### | ### |         |  <- top layer
|    +--+--+--+--+--+--+      |
|    |star | ### |moon |      |
|    +-----+-----+-----+      |
|    | ### |heart| ### |      |
|    +-----+-----+-----+      |
|                             |
|  [return]  [new game]       |  <- return takes back a move; new game is [guess]
+-----------------------------+

  cat, sun, star...  pixel tile you can see and click
  ###                hidden tile, can't be clicked yet
```

## 2. The slot rule

It takes two clicks to send a tile up, so a stray tap can't cost you a slot. A
fast double-click works too.

```
1st click   +=====+      tile is selected, nothing moves
            ||cat||
            +=====+

2nd click   [cat][   ][   ][   ]   tile goes to the next empty slot
```

[guess] Clicking a different tile after the 1st click moves the selection to it.

A matching pair leaves the slots right away. In the examples below, "click" means
both clicks.

Safe: the 4th tile makes a pair.

```
click cat    [cat][   ][   ][   ]
click sun    [cat][sun][   ][   ]
click star   [cat][sun][star][   ]   3 with no pair: fine
click sun    [cat][sun][star][sun]   4th makes a pair
             [cat][star][   ][   ]   pair gone, play on
```

Lost: the 4th tile makes no pair.

```
             [cat][sun][star][   ]
click moon   [cat][sun][star][moon]  full, no pair: GAME OVER
```

## 3. Hidden tiles

```
BEFORE                     AFTER clicking the top tile

      +-----+
      | cat |   on top           (moved to a slot)
   +--+--+--+--+            +-----+-----+
   | ### | ### |  covered   | sun | ### |   sun is free, so it shows
   +-----+-----+            +-----+-----+
                                    ^ [guess] still partly covered
```

[guess] A tile stays hidden while another tile sits on it, and turns face up
once it's free to click.

## 4. How a game ends

```
          click a visible tile twice
                     |
                     v
              goes to a slot
                     |
              makes a pair? --yes--> pair leaves --> board empty? --yes--> WIN
                     |                                    |
                     no                                   no
                     |                                    |
              slots full? --yes--> LOSE                   |
                     |                                    |
                     no                                   |
                     |                                    |
                     +------------> keep playing <--------+
```

## Not drawn yet

- The login page
- The pixel tile art
