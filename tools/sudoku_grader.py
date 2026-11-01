"""A human-technique sudoku grader: plain Python, no dependencies.

A level is the fewest rules that finish the board:

    tier 1, easy:    naked and hidden singles
    tier 2, medium:  also locked candidates, naked and hidden pairs
    tier 3, hard:    also naked and hidden triples, X-wing, XY-wing, Swordfish

solve() always tries the simplest technique first, so a harder one runs only when
everything below it is stuck. No guessing: a board these rules can't finish has no
grade. Each technique is sound, so a finished board also proves its one solution.

Original code, written for this project.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from itertools import combinations
from typing import Callable

ALL = 0x1FF
ROWS = [[r * 9 + c for c in range(9)] for r in range(9)]
COLS = [[r * 9 + c for r in range(9)] for c in range(9)]
BOXES = [
    [(top + r) * 9 + left + c for r in range(3) for c in range(3)]
    for top in (0, 3, 6)
    for left in (0, 3, 6)
]
UNITS = ROWS + COLS + BOXES
PEERS = [
    frozenset(j for unit in UNITS if i in unit for j in unit if j != i) for i in range(81)
]
DIGIT_BITS = [1 << d for d in range(9)]
LEVEL_OF_TIER = {1: "easy", 2: "medium", 3: "hard"}


def _popcount(mask: int) -> int:
    return bin(mask).count("1")


class Board:
    """values: the placed digit per cell, 0 if empty. cand: a bitmask of what an empty
    cell can still hold (bit 0 is digit 1), 0 once placed."""

    def __init__(self) -> None:
        self.values = [0] * 81
        self.cand = [ALL] * 81

    def place(self, i: int, digit: int) -> None:
        self.values[i] = digit
        self.cand[i] = 0
        for j in PEERS[i]:
            self.cand[j] &= ~DIGIT_BITS[digit - 1]

    def remove(self, cells, mask: int) -> bool:
        """Take these candidates from these cells; True if that changed anything."""
        changed = False
        for i in cells:
            if self.cand[i] & mask:
                self.cand[i] &= ~mask
                changed = True
        return changed

    def where(self, unit, bit: int) -> list[int]:
        return [i for i in unit if self.cand[i] & bit]


# Tier 1


def naked_single(board: Board) -> bool:
    for i, mask in enumerate(board.cand):
        if mask and mask & (mask - 1) == 0:
            board.place(i, mask.bit_length())
            return True
    return False


def hidden_single(board: Board) -> bool:
    for unit in UNITS:
        for digit, bit in enumerate(DIGIT_BITS, 1):
            cells = board.where(unit, bit)
            if len(cells) == 1:
                board.place(cells[0], digit)
                return True
    return False


# Tier 2


def locked_candidates(board: Board) -> bool:
    """Pointing: within a box a digit fits only on one line, so the rest of the line
    loses it. Claiming: within a line it fits only in one box, so the rest of the box
    loses it."""
    for box in BOXES:
        for bit in DIGIT_BITS:
            cells = board.where(box, bit)
            if len(cells) < 2:
                continue
            for lines in (ROWS, COLS):
                for line in lines:
                    if all(i in line for i in cells):
                        if board.remove((i for i in line if i not in box), bit):
                            return True
    for lines in (ROWS, COLS):
        for line in lines:
            for bit in DIGIT_BITS:
                cells = board.where(line, bit)
                if len(cells) < 2:
                    continue
                for box in BOXES:
                    if all(i in box for i in cells):
                        if board.remove((i for i in box if i not in line), bit):
                            return True
    return False


def naked_subset(board: Board, size: int) -> bool:
    """size cells of a unit share just size digits, so the rest of the unit loses them."""
    for unit in UNITS:
        cells = [i for i in unit if 2 <= _popcount(board.cand[i]) <= size]
        for group in combinations(cells, size):
            union = 0
            for i in group:
                union |= board.cand[i]
            if _popcount(union) == size:
                if board.remove((i for i in unit if i not in group), union):
                    return True
    return False


def hidden_subset(board: Board, size: int) -> bool:
    """size digits of a unit fit only in size cells, so those cells lose the rest."""
    for unit in UNITS:
        places = {bit: board.where(unit, bit) for bit in DIGIT_BITS}
        digits = [bit for bit, cells in places.items() if 1 <= len(cells) <= size]
        for group in combinations(digits, size):
            cells = {i for bit in group for i in places[bit]}
            if len(cells) == size:
                if board.remove(cells, ALL & ~sum(group)):
                    return True
    return False


# Tier 3


def fish(board: Board, size: int) -> bool:
    """X-wing (size 2) and Swordfish (size 3): in size lines a digit fits only across
    size crossing lines, so those crossing lines lose it everywhere else."""
    for lines, crossing, cross_of in ((ROWS, COLS, lambda i: i % 9), (COLS, ROWS, lambda i: i // 9)):
        for bit in DIGIT_BITS:
            spots = {}
            for n, line in enumerate(lines):
                cells = board.where(line, bit)
                if 2 <= len(cells) <= size:
                    spots[n] = {cross_of(i) for i in cells}
            for group in combinations(spots, size):
                crosses = set().union(*(spots[n] for n in group))
                if len(crosses) == size:
                    base = {i for n in group for i in lines[n]}
                    rest = (i for c in crosses for i in crossing[c] if i not in base)
                    if board.remove(rest, bit):
                        return True
    return False


def xy_wing(board: Board) -> bool:
    """A pivot {x,y} sees pincers {x,z} and {y,z}: one pincer must be z, so whatever
    sees both pincers loses z."""
    bivalue = [i for i, mask in enumerate(board.cand) if _popcount(mask) == 2]
    for pivot in bivalue:
        pivot_mask = board.cand[pivot]
        wings = [
            i
            for i in bivalue
            if i in PEERS[pivot] and _popcount(board.cand[i] & pivot_mask) == 1
        ]
        for a, b in combinations(wings, 2):
            shared = board.cand[a] & board.cand[b]
            # Each pincer takes a different pivot digit, and the same third digit.
            if (
                _popcount(shared) == 1
                and not shared & pivot_mask
                and board.cand[a] & pivot_mask != board.cand[b] & pivot_mask
            ):
                if board.remove((PEERS[a] & PEERS[b]) - {pivot}, shared):
                    return True
    return False


# In the order solve() tries them: (tier, name, one application, True if it progressed).
TECHNIQUES: list[tuple[int, str, Callable[[Board], bool]]] = [
    (1, "Naked Single", naked_single),
    (1, "Hidden Single", hidden_single),
    (2, "Locked Candidates", locked_candidates),
    (2, "Naked Pair", lambda b: naked_subset(b, 2)),
    (2, "Hidden Pair", lambda b: hidden_subset(b, 2)),
    (3, "Naked Triple", lambda b: naked_subset(b, 3)),
    (3, "Hidden Triple", lambda b: hidden_subset(b, 3)),
    (3, "X-Wing", lambda b: fish(b, 2)),
    (3, "XY-Wing", xy_wing),
    (3, "Swordfish", lambda b: fish(b, 3)),
]


@dataclass
class Result:
    board: str  # the digits reached, '.' where it got stuck
    complete: bool
    used: Counter  # technique name -> times applied
    tier: int  # the hardest tier applied, 0 if none


def load(givens: str) -> Board | None:
    """A Board with these givens placed; None if the givens repeat a digit in a unit."""
    board = Board()
    for i, ch in enumerate(givens):
        if ch not in ".0":
            digit = int(ch)
            if not board.cand[i] & DIGIT_BITS[digit - 1]:
                return None
            board.place(i, digit)
    return board


def solve(givens: str, max_tier: int = 3) -> Result:
    """Apply the techniques up to max_tier, simplest first, until none progresses.
    '.' or '0' marks an empty cell."""
    board = load(givens)
    used: Counter = Counter()
    if board is None:
        return Result(givens, False, used, 0)
    tier_used = 0
    progressed = True
    while progressed and not all(board.values):
        progressed = False
        for tier, name, step in TECHNIQUES:
            if tier > max_tier:
                break
            if step(board):
                used[name] += 1
                tier_used = max(tier_used, tier)
                progressed = True
                break
    text = "".join(str(v) if v else "." for v in board.values)
    return Result(text, all(board.values), used, tier_used)


def grade(givens: str) -> str | None:
    """'easy', 'medium' or 'hard': the level that finishes it. None if none does."""
    result = solve(givens)
    return LEVEL_OF_TIER[result.tier] if result.complete and result.tier else None
