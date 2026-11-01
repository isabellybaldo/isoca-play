# Mahjong: quick schematics

`[guess]` marks anything you didn't say.

## 0. Setting up a game

A type is a specific setup, and each one belongs to one difficulty.

```
+-----------------------------+
|  [ easy ] [ medium ] [=hard=]  <- pick the difficulty first
|                             |
|  HARD TYPES        [random] |  <- random picks from this list
|  +-------+                  |
|  | [] [] |                  |
|  |  fort |                  |
|  +-------+                  |
|                             |
|  tap a type to start        |
+-----------------------------+

easy     frame    barely stacked, 2 layers
medium   trophy   some stacking, 3 layers
hard     fort     taller stacks, 4 layers
```

## 1. The screen (phone)

```
+-----------------------------+
|  back          moves: 12    |  <- [guess] top bar
|                             |
|  SLOTS                      |
|  +-----+-----+-----+-----+  |
|  | cat | fish|     |     |  |  <- your 4 slots
|  +-----+-----+-----+-----+  |
|                             |
|  BOARD                      |
|       +-----+-----+         |
|       | ### | ### |         |  <- top layer
|    +--+--+--+--+--+--+      |
|    |frog | ### |plum |      |
|    +-----+-----+-----+      |
|    | ### |heart| ### |      |
|    +-----+-----+-----+      |
|                             |
|  [return]  [new game]       |  <- return takes back a move; new game is [guess]
+-----------------------------+

  cat, fish, frog...  pixel tile you can see and click
  ###                 hidden tile, shows its rose back, can't be clicked yet
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
click fish   [cat][fish][   ][   ]
click frog   [cat][fish][frog][   ]   3 with no pair: fine
click fish   [cat][fish][frog][fish]  4th makes a pair
             [cat][frog][   ][   ]    pair gone, play on
```

Lost: the 4th tile makes no pair.

```
             [cat][fish][frog][   ]
click plum   [cat][fish][frog][plum]  full, no pair: GAME OVER
```

What makes a pair: any season with any season, any flower with any flower, and
anything else only with itself.

```
             [spring][   ][   ][   ]
click winter [   ][   ][   ][   ]      two seasons: a pair

             [spring][   ][   ][   ]
click rose   [spring][rose][   ][   ]  a season and a flower: no pair
```

## 3. Hidden tiles

An upper tile sits half a tile over the tiles below, never exactly on top, so the
covered tiles show their rose backs.

```
BEFORE                     AFTER clicking the top tile

      +-----+
      | cat |   on top           (moved to a slot)
   +--+--+--+--+            +-----+-----+
   | ### | ### |  covered   | fish| frog|   nothing on them, so they show
   +-----+-----+            +-----+-----+
```

A tile stays hidden while another tile lies on any part of it, and turns face up
once nothing does. It can still be blocked at both sides, and then it is dimmed.

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
