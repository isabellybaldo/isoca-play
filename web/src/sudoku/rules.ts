import type { Level } from '../mahjong/layouts';

export type Puzzle = { level: Level; givens: string; solution: string };

export type SudokuState = {
  puzzle: Puzzle;
  values: number[];
  notes: number[];
  selected: number | null;
  mode: 'write' | 'notes';
  // `peers` are the other squares whose note this move's number erased; only present if any were.
  history: { cell: number; value: number; notes: number; peers?: number[] }[];
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

// The written squares that differ from the solution. Only a tip asks; the board never shows it.
export function wrongCells(s: SudokuState): number[] {
  return s.values.flatMap((v, cell) => (v !== 0 && !isGiven(s, cell) && String(v) !== s.puzzle.solution[cell] ? [cell] : []));
}

export function selectCell(s: SudokuState, cell: number): SudokuState {
  return { ...s, selected: cell };
}

export function setMode(s: SudokuState, mode: 'write' | 'notes'): SudokuState {
  return { ...s, mode };
}

function sharesAUnit(a: number, b: number): boolean {
  const sameRow = Math.floor(a / 9) === Math.floor(b / 9);
  const sameCol = a % 9 === b % 9;
  const sameBox = Math.floor(a / 27) === Math.floor(b / 27) && Math.floor((a % 9) / 3) === Math.floor((b % 9) / 3);
  return sameRow || sameCol || sameBox;
}

// How the selected square lights this one: the same number if it holds one, else its row,
// column and box. Only ever drawn, never saved.
export function glowOf(s: SudokuState, cell: number): 'same' | 'peer' | null {
  const at = s.selected;
  if (at === null || at === cell) return null;
  if (s.values[at] !== 0) return s.values[cell] === s.values[at] ? 'same' : null;
  return sharesAUnit(cell, at) ? 'peer' : null;
}

export function pressDigit(s: SudokuState, d: number): SudokuState {
  const cell = s.selected;
  if (cell === null || s.status === 'won' || isGiven(s, cell)) return s;
  const prev: SudokuState['history'][number] = { cell, value: s.values[cell], notes: s.notes[cell] };
  const values = [...s.values];
  const notes = [...s.notes];
  const bit = 1 << (d - 1);
  if (s.mode === 'notes') {
    if (prev.value !== 0) return s;
    notes[cell] = prev.notes ^ bit;
  } else {
    values[cell] = prev.value === d ? 0 : d;
    notes[cell] = 0;
    if (values[cell] !== 0) {
      const peers = notes.flatMap((n, c) => (c !== cell && n & bit && sharesAUnit(c, cell) ? [c] : []));
      for (const c of peers) notes[c] &= ~bit;
      if (peers.length > 0) prev.peers = peers;
    }
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
  // Before the value is put back: the number being taken away is the note its peers lost.
  for (const c of last.peers ?? []) notes[c] |= 1 << (values[last.cell] - 1);
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
