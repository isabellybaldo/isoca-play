import { describe, expect, test } from 'vitest';
import { newSudoku, pressDigit, selectCell, setMode, undo, wrongCells } from './rules';
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
