import type { Level } from '../mahjong/layouts';

export type Puzzle = { level: Level; givens: string; solution: string };

export type SudokuState = {
  puzzle: Puzzle;
  values: number[];
  notes: number[];
  selected: number | null;
  mode: 'write' | 'notes';
  history: { cell: number; value: number; notes: number }[];
  status: 'playing' | 'won' | 'unsolved';
};

export function newSudoku(p: Puzzle): SudokuState {
  return {
    puzzle: p,
    values: [...p.givens].map((ch) => (ch === '.' ? 0 : Number(ch))),
    notes: new Array<number>(81).fill(0),
    selected: null,
    mode: 'write',
    history: [],
    status: 'playing',
  };
}

const isGiven = (s: SudokuState, cell: number) => s.puzzle.givens[cell] !== '.';

function statusOf(p: Puzzle, values: number[]): SudokuState['status'] {
  if (values.includes(0)) return 'playing';
  return values.join('') === p.solution ? 'won' : 'unsolved';
}

// A new deal would throw away work: there are moves, and the board is not solved.
export function hasMovesToLose(s: SudokuState): boolean {
  return s.history.length > 0 && s.status !== 'won';
}

export function selectCell(s: SudokuState, cell: number): SudokuState {
  return { ...s, selected: cell };
}

export function setMode(s: SudokuState, mode: 'write' | 'notes'): SudokuState {
  return { ...s, mode };
}

export function pressDigit(s: SudokuState, d: number): SudokuState {
  const cell = s.selected;
  if (cell === null || s.status === 'won' || isGiven(s, cell)) return s;
  const prev = { cell, value: s.values[cell], notes: s.notes[cell] };
  const values = [...s.values];
  const notes = [...s.notes];
  if (s.mode === 'notes') {
    if (prev.value !== 0) return s;
    notes[cell] = prev.notes ^ (1 << (d - 1));
  } else {
    values[cell] = prev.value === d ? 0 : d;
    notes[cell] = 0;
  }
  return {
    ...s,
    values,
    notes,
    history: [...s.history, prev],
    status: statusOf(s.puzzle, values),
  };
}

export function undo(s: SudokuState): SudokuState {
  const last = s.history.at(-1);
  if (!last) return s;
  const values = [...s.values];
  const notes = [...s.notes];
  values[last.cell] = last.value;
  notes[last.cell] = last.notes;
  return {
    ...s,
    values,
    notes,
    history: s.history.slice(0, -1),
    status: statusOf(s.puzzle, values),
  };
}
