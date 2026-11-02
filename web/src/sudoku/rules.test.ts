import { describe, expect, test } from 'vitest';
import { glowOf, newSudoku, pressDigit, selectCell, setMode, undo, wrongCells } from './rules';
import type { SudokuState } from './rules';
import { blanked } from '../fakeServer.testutil';

const P = blanked('easy', [0, 1, 2, 12, 40, 41, 70, 80]);
const emptyCells = [...P.givens].flatMap((ch, i) => (ch === '.' ? [i] : []));
const givenCell = [...P.givens].findIndex((ch) => ch !== '.');
const sol = (i: number) => Number(P.solution[i]);
const wrongFor = (i: number) => (sol(i) % 9) + 1;

function fillAllButOne(): { s: SudokuState; last: number } {
  let s = newSudoku(P);
  const last = emptyCells[emptyCells.length - 1];
  for (const c of emptyCells.slice(0, -1)) s = pressDigit(selectCell(s, c), sol(c));
  return { s, last };
}

describe('sudoku rules', () => {
  test('notes toggle and write replaces them', () => {
    const c = emptyCells[0];
    let s = setMode(selectCell(newSudoku(P), c), 'notes');
    s = pressDigit(s, 3);
    s = pressDigit(s, 5);
    expect(s.notes[c]).toBe((1 << 2) | (1 << 4));
    s = pressDigit(s, 3);
    expect(s.notes[c]).toBe(1 << 4);
    s = pressDigit(setMode(s, 'write'), 7);
    expect(s.values[c]).toBe(7);
    expect(s.notes[c]).toBe(0);
    // notes mode does nothing on a filled cell, and adds no history
    const before = s;
    s = pressDigit(setMode(s, 'notes'), 2);
    expect(s.notes[c]).toBe(0);
    expect(s.values[c]).toBe(7);
    expect(s.history).toHaveLength(before.history.length);
  });

  describe('writing a number and the notes it rules out', () => {
    const FOUR = 1 << 3;
    const SIX = 1 << 5;
    // Cell 40 is the centre: 36 shares its row, 4 its column, 30 its box, and 0 none of them.
    const noted = (cells: number[], mask: number): SudokuState => ({
      ...selectCell(newSudoku(P), 40),
      notes: new Array<number>(81).fill(0).map((_, i) => (cells.includes(i) ? mask : 0)),
    });

    test('takes that digit out of its row, column and box, and leaves the rest', () => {
      const s = pressDigit(noted([36, 4, 30, 0], FOUR | SIX), 4);
      for (const c of [36, 4, 30]) expect(s.notes[c]).toBe(SIX);
      expect(s.notes[0]).toBe(FOUR | SIX);
    });

    test('Return brings the notes back, and one Return is one move', () => {
      const before = noted([36, 4, 30, 0], FOUR | SIX);
      const s = undo(pressDigit(before, 4));
      expect(s.notes).toEqual(before.notes);
      expect(s.history).toHaveLength(0);
    });

    test('Return does not add a note the number never took', () => {
      const s = undo(pressDigit(noted([36], SIX), 4));
      expect(s.notes[36]).toBe(SIX);
    });

    test('overwriting a number takes out the new digit, and Return returns only that', () => {
      const before = pressDigit(noted([36], FOUR | SIX), 4);
      const s = pressDigit(before, 6);
      expect(s.notes[36]).toBe(0);
      expect(undo(s).notes[36]).toBe(SIX);
    });

    test('erasing a number or making a note leaves other squares alone', () => {
      const written = pressDigit(noted([36], SIX), 4);
      expect(pressDigit(written, 4).notes[36]).toBe(SIX);
      expect(pressDigit(setMode(noted([36], FOUR), 'notes'), 4).notes[36]).toBe(FOUR);
    });

    test('Return still works on a move saved before notes were erased', () => {
      const s = pressDigit(noted([], 0), 4);
      const old = { ...s, history: [{ cell: 40, value: 0, notes: 0 }] };
      expect(undo(old).values[40]).toBe(0);
    });
  });

  test('givens cannot change in either mode', () => {
    const g = Number(P.givens[givenCell]);
    let s = selectCell(newSudoku(P), givenCell);
    s = pressDigit(s, (g % 9) + 1);
    expect(s.values[givenCell]).toBe(g);
    s = pressDigit(s, g);
    expect(s.values[givenCell]).toBe(g);
    s = pressDigit(setMode(s, 'notes'), 4);
    expect(s.notes[givenCell]).toBe(0);
    expect(s.history).toHaveLength(0);
  });

  test('pressing the same digit erases the value', () => {
    const c = emptyCells[0];
    let s = selectCell(newSudoku(P), c);
    s = pressDigit(s, 4);
    expect(s.values[c]).toBe(4);
    s = pressDigit(s, 4);
    expect(s.values[c]).toBe(0);
  });

  test('pressDigit with nothing selected does nothing', () => {
    const s = newSudoku(P);
    expect(s.selected).toBeNull();
    expect(pressDigit(s, 5)).toEqual(s);
  });

  test('a wrong digit changes nothing but the value while the board has gaps', () => {
    const c = emptyCells[0];
    const s = pressDigit(selectCell(newSudoku(P), c), wrongFor(c));
    expect(s.values[c]).toBe(wrongFor(c));
    expect(s.status).toBe('playing');
  });

  test('full and wrong reports unsolved; undo returns to playing; fixing it wins', () => {
    const { s: almost, last } = fillAllButOne();
    expect(almost.status).toBe('playing');
    const wrong = pressDigit(selectCell(almost, last), wrongFor(last));
    expect(wrong.status).toBe('unsolved');
    // unsolved allows further edits: overwrite with the right digit
    expect(pressDigit(wrong, sol(last)).status).toBe('won');
    // undo returns to playing, and fixing it then wins
    const back = undo(wrong);
    expect(back.status).toBe('playing');
    expect(back.values[last]).toBe(0);
    expect(pressDigit(selectCell(back, last), sol(last)).status).toBe('won');
  });

  test('undo restores the value and notes of one change; no history is a no-op', () => {
    const c = emptyCells[0];
    const fresh = newSudoku(P);
    expect(undo(fresh)).toEqual(fresh);
    let s = setMode(selectCell(fresh, c), 'notes');
    s = pressDigit(pressDigit(s, 2), 6);
    const withNotes = s.notes[c];
    s = pressDigit(setMode(s, 'write'), 8);
    expect(s.notes[c]).toBe(0);
    s = undo(s);
    expect(s.values[c]).toBe(0);
    expect(s.notes[c]).toBe(withNotes);
    expect(s.history).toHaveLength(2);
    // selection and mode are not history
    expect(s.selected).toBe(c);
    expect(s.mode).toBe('write');
    s = undo(undo(s));
    expect(s.notes[c]).toBe(0);
    expect(s.history).toHaveLength(0);
  });

  test('after a win, pressDigit changes nothing; undo is allowed', () => {
    const { s: almost, last } = fillAllButOne();
    const won = pressDigit(selectCell(almost, last), sol(last));
    expect(won.status).toBe('won');
    expect(pressDigit(won, wrongFor(last))).toEqual(won);
    const back = undo(won);
    expect(back.status).toBe('playing');
    expect(back.values[last]).toBe(0);
  });

  test('the state has no field naming mistakes or conflicts', () => {
    expect(Object.keys(newSudoku(P)).sort()).toEqual([
      'history',
      'mode',
      'notes',
      'puzzle',
      'selected',
      'status',
      'values',
    ]);
  });
});

describe('glowOf', () => {
  const lit = (s: SudokuState, glow: 'same' | 'peer') => s.values.flatMap((_, c) => (glowOf(s, c) === glow ? [c] : []));

  test('nothing glows with nothing selected', () => {
    const s = newSudoku(P);
    expect(lit(s, 'same')).toEqual([]);
    expect(lit(s, 'peer')).toEqual([]);
  });

  test('a filled square lights the other squares holding its number, given or written', () => {
    const digit = sol(givenCell);
    let s = newSudoku(P);
    const blank = emptyCells.find((c) => sol(c) !== digit)!;
    s = selectCell(pressDigit(selectCell(s, blank), digit), givenCell);
    const others = s.values.flatMap((v, c) => (v === digit && c !== givenCell ? [c] : []));
    expect(others).toContain(blank);
    expect(lit(s, 'same')).toEqual(others);
    expect(lit(s, 'peer')).toEqual([]);
  });

  test('an empty square lights its row, column and box, but not itself', () => {
    const s = selectCell(newSudoku(P), 40);
    const peers = lit(s, 'peer');
    expect(peers).toHaveLength(20);
    expect(peers).not.toContain(40);
    for (const c of [36, 44, 4, 76, 30, 50]) expect(peers).toContain(c);
    for (const c of [0, 27, 53, 80]) expect(peers).not.toContain(c);
    expect(lit(s, 'same')).toEqual([]);
  });
});

describe('wrongCells', () => {
  test('lists the written squares that differ from the solution, and nothing else', () => {
    let s = newSudoku(P);
    expect(wrongCells(s)).toEqual([]);
    const [a, b, c] = emptyCells;
    s = pressDigit(selectCell(s, a), wrongFor(a));
    s = pressDigit(selectCell(s, b), sol(b));
    s = pressDigit(setMode(selectCell(s, c), 'notes'), wrongFor(c)); // a note is not a number
    expect(wrongCells(s)).toEqual([a]);
  });

  test('a given is never wrong, and an emptied square is not', () => {
    let s = newSudoku(P);
    const a = emptyCells[0];
    s = pressDigit(selectCell(s, a), wrongFor(a));
    s = pressDigit(s, wrongFor(a));
    expect(wrongCells(s)).toEqual([]);
    expect(wrongCells({ ...s, values: s.values.map((v, i) => (i === givenCell ? 0 : v)) })).toEqual([]);
  });
});
