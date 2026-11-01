import json
import sys
from pathlib import Path

import pytest

from conftest import BASE_URL
from isoca_play import sudoku
from isoca_play.sudoku import LEVELS, PACK

ORIGIN = {"Origin": BASE_URL}
TOOLS = Path(__file__).resolve().parents[2] / "tools"
sys.path.insert(0, str(TOOLS))

import make_tip_cases  # noqa: E402  (plain Python, from the repo's tools/)
import sudoku_grader as grader  # noqa: E402  (plain Python, from the repo's tools/)

ALL = 0x1FF
TIER = {"easy": 1, "medium": 2, "hard": 3}
# 30 per level, spread evenly through the pack.
PACK_SAMPLE = [{"level": level, **p} for level in LEVELS for p in PACK[level][::10]]


def find_solutions(givens, limit=2):
    """Up to limit solutions, by plain backtracking that shares nothing with the grader."""
    grid = [0 if ch == "." else int(ch) for ch in givens]
    found = []

    def options(i):
        r, c = i // 9, i % 9
        taken = set(grid[r * 9 : r * 9 + 9]) | set(grid[c::9])
        top, left = r - r % 3, c - c % 3
        for y in range(top, top + 3):
            taken |= set(grid[y * 9 + left : y * 9 + left + 3])
        return [d for d in range(1, 10) if d not in taken]

    def search():
        best, moves = None, None
        for i, value in enumerate(grid):
            if value == 0:
                here = options(i)
                if moves is None or len(here) < len(moves):
                    best, moves = i, here
                    if len(moves) <= 1:
                        break
        if best is None:
            found.append("".join(map(str, grid)))
            return
        for digit in moves:
            grid[best] = digit
            search()
            grid[best] = 0
            if len(found) >= limit:
                return

    search()
    return found


def post(client, **kwargs):
    kwargs.setdefault("headers", ORIGIN)
    return client.post("/api/new/sudoku", **kwargs)


# The pack


def test_pack_has_300_per_level():
    assert list(PACK) == list(LEVELS) == ["easy", "medium", "hard"]
    assert [len(PACK[level]) for level in LEVELS] == [300, 300, 300]


def test_pack_has_no_repeats_and_only_givens_and_solutions():
    every = [p for level in LEVELS for p in PACK[level]]
    assert len({p["givens"] for p in every}) == 900
    assert all(set(p) == {"givens", "solution"} for p in every)


@pytest.mark.parametrize("p", PACK_SAMPLE, ids=lambda p: f"{p['level']}-{p['givens'][:12]}")
def test_puzzle_has_one_solution_and_matches(p):
    assert len(p["givens"]) == 81
    assert all(g in (".", s) for g, s in zip(p["givens"], p["solution"]))
    assert find_solutions(p["givens"]) == [p["solution"]]


def test_harder_levels_give_fewer_numbers_on_average():
    def mean(level):
        return sum(81 - p["givens"].count(".") for p in PACK[level]) / len(PACK[level])

    assert mean("easy") > mean("medium") > mean("hard")


@pytest.mark.parametrize("level", LEVELS)
def test_every_puzzle_solves_at_its_level_and_needs_that_level(level):
    """The owner's rule, for the whole pack: this level's rules finish the board with
    the stored answer, and the rules below it get stuck."""
    tier = TIER[level]
    for p in PACK[level]:
        assert grader.solve(p["givens"], max_tier=tier).board == p["solution"], p["givens"]
        assert not grader.solve(p["givens"], max_tier=tier - 1).complete, p["givens"]
        assert grader.grade(p["givens"]) == level


# The grader's techniques, each on a board made to show just that pattern


def cell(row, col):
    return row * 9 + col


def bits(*digits):
    return sum(1 << (d - 1) for d in digits)


def restrict_row(board, row, digit, cols):
    """The digit stays a candidate in this row only at these columns."""
    for col in range(9):
        if col not in cols:
            board.cand[cell(row, col)] &= ~bits(digit)


def has(board, row, col, digit):
    return bool(board.cand[cell(row, col)] & bits(digit))


def test_naked_single_places_the_only_candidate():
    board = grader.Board()
    board.cand[cell(4, 4)] = bits(7)
    assert grader.naked_single(board)
    assert board.values[cell(4, 4)] == 7
    assert not has(board, 4, 0, 7) and not has(board, 0, 4, 7) and not has(board, 3, 3, 7)


def test_hidden_single_places_the_only_place_in_a_unit():
    board = grader.Board()
    restrict_row(board, 2, 6, {5})
    assert grader.hidden_single(board)
    assert board.values[cell(2, 5)] == 6


def test_pointing_clears_the_line_outside_the_box():
    board = grader.Board()
    for row in (1, 2):
        for col in range(3):
            board.cand[cell(row, col)] &= ~bits(5)
    board.cand[cell(0, 2)] &= ~bits(5)
    assert grader.locked_candidates(board)
    assert has(board, 0, 0, 5) and has(board, 0, 1, 5)
    assert not has(board, 0, 5, 5) and not has(board, 0, 8, 5)
    assert has(board, 3, 3, 5)


def test_claiming_clears_the_box_outside_the_line():
    board = grader.Board()
    restrict_row(board, 0, 5, {0, 1})
    assert grader.locked_candidates(board)
    assert not has(board, 1, 0, 5) and not has(board, 2, 2, 5)
    assert has(board, 1, 3, 5)


def test_no_lock_means_no_change():
    board = grader.Board()
    assert not grader.locked_candidates(board)
    assert board.cand == [ALL] * 81


def test_naked_pair_clears_the_rest_of_the_unit():
    board = grader.Board()
    board.cand[cell(0, 0)] = board.cand[cell(0, 4)] = bits(1, 2)
    assert grader.naked_subset(board, 2)
    assert not has(board, 0, 8, 1) and not has(board, 0, 8, 2)
    assert has(board, 0, 8, 3) and has(board, 1, 0, 1)
    assert board.cand[cell(0, 0)] == bits(1, 2)


def test_hidden_pair_clears_the_cells_of_other_digits():
    board = grader.Board()
    for digit in (1, 2):
        restrict_row(board, 0, digit, {0, 4})
    assert grader.hidden_subset(board, 2)
    assert board.cand[cell(0, 0)] == bits(1, 2) == board.cand[cell(0, 4)]
    assert board.cand[cell(0, 8)] == ALL & ~bits(1, 2)


def test_naked_triple_where_no_cell_holds_all_three():
    board = grader.Board()
    board.cand[cell(0, 0)] = bits(1, 2)
    board.cand[cell(0, 4)] = bits(2, 3)
    board.cand[cell(0, 8)] = bits(1, 3)
    assert not grader.naked_subset(board, 2)
    assert grader.naked_subset(board, 3)
    assert board.cand[cell(0, 2)] == ALL & ~bits(1, 2, 3)
    assert board.cand[cell(0, 0)] == bits(1, 2)


def test_hidden_triple_clears_the_cells_of_other_digits():
    board = grader.Board()
    for digit in (1, 2, 3):
        restrict_row(board, 0, digit, {0, 4, 8})
    assert not grader.hidden_subset(board, 2)
    assert grader.hidden_subset(board, 3)
    assert board.cand[cell(0, 4)] == bits(1, 2, 3)


def test_x_wing_on_rows_clears_its_columns():
    board = grader.Board()
    for row in (0, 4):
        restrict_row(board, row, 5, {1, 7})
    assert grader.fish(board, 2)
    assert not has(board, 2, 1, 5) and not has(board, 8, 7, 5)
    assert has(board, 0, 1, 5) and has(board, 4, 7, 5) and has(board, 2, 2, 5)


def test_x_wing_on_columns_clears_its_rows():
    board = grader.Board()
    for col in (1, 7):
        for row in range(9):
            if row not in (0, 4):
                board.cand[cell(row, col)] &= ~bits(5)
    assert grader.fish(board, 2)
    assert not has(board, 0, 4, 5) and not has(board, 4, 0, 5)
    assert has(board, 0, 1, 5) and has(board, 2, 2, 5)


def test_swordfish_clears_its_columns_and_is_not_an_x_wing():
    board = grader.Board()
    for row in (0, 4, 8):
        restrict_row(board, row, 5, {1, 4, 7})
    assert not grader.fish(board, 2)
    assert grader.fish(board, 3)
    assert not has(board, 2, 4, 5) and has(board, 2, 2, 5) and has(board, 4, 4, 5)


def test_xy_wing_clears_what_both_pincers_see():
    board = grader.Board()
    board.cand[cell(0, 0)] = bits(1, 2)
    board.cand[cell(0, 8)] = bits(1, 3)
    board.cand[cell(8, 0)] = bits(2, 3)
    assert grader.xy_wing(board)
    assert not has(board, 8, 8, 3)
    assert has(board, 8, 8, 1) and has(board, 8, 4, 3)


def test_xy_wing_needs_the_pincers_to_share_a_digit():
    board = grader.Board()
    board.cand[cell(0, 0)] = bits(1, 2)
    board.cand[cell(0, 8)] = bits(1, 3)
    board.cand[cell(8, 0)] = bits(2, 4)
    assert not grader.xy_wing(board)


# The grader's ladder, on boards graded by another solver: rustoku 0.16.0's solve path
# named only allowed techniques, and its level below could not finish them.


@pytest.mark.parametrize(
    "givens, expected",
    [
        ("6.....9.........6793..67852793.4.528.15328..9...5793..12..3.49.34968.715..6.1...3", "easy"),
        (".3.4..9..679.32....2.....3....7..2....25..7145..92.....4...51.6........83...48...", "medium"),
        ("............1.5.4.21.968...1.7...5.8...6.79...3.8...2...3..62.1.9.7.2.8582.4.....", "medium"),
        ("6.7.953...5...3..6.....79..4...5.2......4.6.8...9......43.89...1.2........87..5.1", "hard"),
        (".2.3..7.....9..1...5.6......9...1.8.4...6.2.1......5..1....2..46....8.13..5.....2", "hard"),
        ("9.25.4....78.6.2..6......35...3..7...8....39.....2.......7...12........9..4.52...", "hard"),
    ],
)
def test_grade_agrees_with_another_solver(givens, expected):
    assert grader.grade(givens) == expected
    assert find_solutions(givens) == [grader.solve(givens).board]


def test_a_board_past_these_rules_has_no_grade():
    # One solution, but no technique we allow finishes it.
    givens = "8..........36......7..9.2...5...7.......457.....1...3...1....68..85...1..9....4.."
    assert len(find_solutions(givens)) == 1
    assert not grader.solve(givens).complete
    assert grader.grade(givens) is None


def test_a_board_with_two_solutions_has_no_grade():
    # Two rows of this grid can swap two digits, in two columns across two boxes.
    solved = "534678912672195348198342567859761423426853791713924856961537284287419635345286179"
    corners = swappable_rectangle(solved)
    givens = "".join("." if i in corners else ch for i, ch in enumerate(solved))
    assert len(find_solutions(givens)) == 2
    assert grader.grade(givens) is None


def swappable_rectangle(solved):
    for r1 in range(9):
        for r2 in range(r1 + 1, 9):
            for c1 in range(9):
                for c2 in range(c1 + 1, 9):
                    a, b = solved[cell(r1, c1)], solved[cell(r1, c2)]
                    two_boxes = (r1 // 3 == r2 // 3) != (c1 // 3 == c2 // 3)
                    if two_boxes and solved[cell(r2, c1)] == b and solved[cell(r2, c2)] == a:
                        return {cell(r1, c1), cell(r1, c2), cell(r2, c1), cell(r2, c2)}
    raise AssertionError("no rectangle in this grid")


def test_grader_refuses_a_board_that_repeats_a_digit():
    givens = "11" + "." * 79
    assert not grader.solve(givens).complete
    assert grader.grade(givens) is None


# The route


@pytest.mark.parametrize("level", LEVELS)
def test_new_game_comes_from_that_level(client, sign_in, level):
    sign_in(client)
    response = post(client, json={"level": level})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"level", "givens", "solution"}
    assert body["level"] == level
    assert {"givens": body["givens"], "solution": body["solution"]} in PACK[level]
    assert response.headers["cache-control"] == "no-store"


def test_new_game_differs_from_the_not_field(client, sign_in, monkeypatch):
    sign_in(client)
    two = PACK["hard"][:2]
    monkeypatch.setitem(sudoku.PACK, "hard", two)
    for _ in range(30):
        body = post(client, json={"level": "hard", "not": two[0]["givens"]}).json()
        assert body["givens"] == two[1]["givens"]


def test_not_is_optional_and_any_other_value_excludes_nothing(client, sign_in):
    sign_in(client)
    for extra in ({}, {"not": None}, {"not": 7}, {"not": ["x"]}, {"not": "unknown"}):
        assert post(client, json={"level": "easy", **extra}).status_code == 200


def test_it_needs_a_session(client):
    assert post(client, json={"level": "easy"}).status_code == 401


def test_it_needs_the_origin(client, sign_in):
    sign_in(client)
    assert post(client, json={"level": "easy"}, headers={}).status_code == 403


def test_an_unknown_level_is_404(client, sign_in):
    sign_in(client)
    assert post(client, json={"level": "expert"}).status_code == 404


@pytest.mark.parametrize(
    "body",
    [b"", b"nope", b"[]", b"{}", json.dumps({"level": 3}).encode(), json.dumps({"level": []}).encode()],
)
def test_a_body_naming_no_level_is_400(client, sign_in, body):
    sign_in(client)
    assert post(client, content=body).status_code == 400


def test_a_huge_body_is_413(client, sign_in):
    sign_in(client)
    assert post(client, content=b"x" * (512 * 1024 + 1)).status_code == 413


def test_the_tip_cases_file_is_what_the_generator_writes():
    cases = json.loads((TOOLS.parent / "shared" / "tip-cases.json").read_text(encoding="utf-8"))
    assert len(cases) == sum(len(puzzles) for puzzles in PACK.values())
    # The file's order is the pack's. Five boards, spread through it, keep it from going stale.
    pack = [p for level in LEVELS for p in PACK[level]]
    for case, puzzle in zip(cases, pack):
        assert (case["givens"], case["solution"]) == (puzzle["givens"], puzzle["solution"])
    for case in cases[::180]:
        assert make_tip_cases.board_tips(case["givens"]) == (case["tips"], case["solution"])
