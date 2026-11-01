// The next sudoku move and why: a port of tools/sudoku_grader.py that keeps what each step
// proved. The order things are tried in is the grader's, and shared/tip-cases.json pins it,
// so a loop here shouldn't change shape without that file agreeing.

export type Candidate = { cell: number; digit: number };
export type TipStep = {
  technique: string; // the grader's name, e.g. 'XY-Wing'
  cells: number[]; // the squares that prove it, in the order to draw them
  unit?: { kind: 'row' | 'column' | 'box'; index: number };
  removes: Candidate[]; // empty on the last step
  places?: Candidate; // only on the last step
  relies: Candidate[]; // the candidates that must be absent for this step to hold
  because: string; // the one or two plain lines shown
};

// As in the grader: cells count 0 to 80 across the rows, and bit 0 of a mask is digit 1.
const ALL = 0x1ff;
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const nine = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const ROWS = nine.map((r) => nine.map((c) => r * 9 + c));
const COLS = nine.map((c) => nine.map((r) => r * 9 + c));
const BOXES = nine.map((b) =>
  nine.map((n) => (Math.floor(b / 3) * 3 + Math.floor(n / 3)) * 9 + (b % 3) * 3 + (n % 3)),
);
const UNITS = [...ROWS, ...COLS, ...BOXES];
const PEERS = Array.from({ length: 81 }, (_, i) => {
  const peers = new Set<number>();
  for (const unit of UNITS) if (unit.includes(i)) for (const j of unit) if (j !== i) peers.add(j);
  return peers;
});

const bitOf = (digit: number) => 1 << (digit - 1);
const digitsIn = (mask: number) => DIGITS.filter((d) => mask & bitOf(d));
const popcount = (mask: number) => digitsIn(mask).length;

// In the order Python's itertools.combinations gives them.
function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  return items.flatMap((item, n) =>
    combinations(items.slice(n + 1), size - 1).map((rest) => [item, ...rest]),
  );
}

type Board = { values: number[]; cand: number[] };

function candidatesOf(values: number[]): Board {
  const cand = values.map((value) => (value ? 0 : ALL));
  values.forEach((value, i) => {
    if (value) for (const j of PEERS[i]) cand[j] &= ~bitOf(value);
  });
  return { values, cand };
}

const where = (b: Board, unit: number[], digit: number) => unit.filter((i) => b.cand[i] & bitOf(digit));

// What taking these digits from these cells would really take: only what is there.
function present(b: Board, cells: number[], mask: number): Candidate[] {
  return cells.flatMap((cell) => digitsIn(b.cand[cell] & mask).map((digit) => ({ cell, digit })));
}

// A written square has no candidates to speak of, so only empty ones are listed.
function absent(b: Board, cells: number[], mask: number): Candidate[] {
  return cells.flatMap((cell) =>
    b.values[cell] ? [] : digitsIn(ALL & mask & ~b.cand[cell]).map((digit) => ({ cell, digit })),
  );
}

// Plain words, numbered from 1.
function listOf(items: number[], word: 'and' | 'or'): string {
  return items.length === 1 ? `${items[0]}` : `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`;
}
const squareName = (i: number) => `row ${Math.floor(i / 9) + 1}, column ${(i % 9) + 1}`;
const COUNT: Record<number, string> = { 2: 'two', 3: 'three' };

type Unit = NonNullable<TipStep['unit']>;
function unitAt(n: number): Unit {
  if (n < 9) return { kind: 'row', index: n };
  if (n < 18) return { kind: 'column', index: n - 9 };
  return { kind: 'box', index: n - 18 };
}
const unitName = (u: Unit) => `${u.kind} ${u.index + 1}`;

function nakedSingle(b: Board): TipStep | null {
  for (let cell = 0; cell < 81; cell++) {
    const mask = b.cand[cell];
    if (mask && (mask & (mask - 1)) === 0) {
      const digit = digitsIn(mask)[0];
      return {
        technique: 'Naked Single',
        cells: [cell],
        removes: [],
        places: { cell, digit },
        relies: absent(b, [cell], ALL & ~mask),
        because: `Naked Single: only ${digit} fits in ${squareName(cell)}.`,
      };
    }
  }
  return null;
}

function hiddenSingle(b: Board): TipStep | null {
  for (let n = 0; n < UNITS.length; n++) {
    for (const digit of DIGITS) {
      const cells = where(b, UNITS[n], digit);
      if (cells.length === 1) {
        const unit = unitAt(n);
        return {
          technique: 'Hidden Single',
          cells,
          unit,
          removes: [],
          places: { cell: cells[0], digit },
          relies: absent(b, UNITS[n].filter((i) => i !== cells[0]), bitOf(digit)),
          because: `Hidden Single: in ${unitName(unit)}, ${digit} only fits here.`,
        };
      }
    }
  }
  return null;
}

function lockedStep(b: Board, digit: number, cells: number[], from: number[], fromNo: number, to: number[], toNo: number): TipStep | null {
  const removes = present(b, to.filter((i) => !from.includes(i)), bitOf(digit));
  if (!removes.length) return null;
  const unit = unitAt(fromNo);
  const target = unitName(unitAt(toNo));
  return {
    technique: 'Locked Candidates',
    cells,
    unit,
    removes,
    relies: absent(b, from.filter((i) => !cells.includes(i)), bitOf(digit)),
    because: `Locked Candidates: in ${unitName(unit)}, ${digit} only fits in ${target}, so the rest of ${target} can't be ${digit}.`,
  };
}

// Pointing: within a box a digit fits only on one line. Claiming: within a line, only in one box.
function lockedCandidates(b: Board): TipStep | null {
  for (let bn = 18; bn < 27; bn++) {
    for (const digit of DIGITS) {
      const cells = where(b, UNITS[bn], digit);
      if (cells.length < 2) continue;
      for (let ln = 0; ln < 18; ln++) {
        if (cells.every((i) => UNITS[ln].includes(i))) {
          const step = lockedStep(b, digit, cells, UNITS[bn], bn, UNITS[ln], ln);
          if (step) return step;
        }
      }
    }
  }
  for (let ln = 0; ln < 18; ln++) {
    for (const digit of DIGITS) {
      const cells = where(b, UNITS[ln], digit);
      if (cells.length < 2) continue;
      for (let bn = 18; bn < 27; bn++) {
        if (cells.every((i) => UNITS[bn].includes(i))) {
          const step = lockedStep(b, digit, cells, UNITS[ln], ln, UNITS[bn], bn);
          if (step) return step;
        }
      }
    }
  }
  return null;
}

function nakedSubset(b: Board, size: number, technique: string): TipStep | null {
  for (let n = 0; n < UNITS.length; n++) {
    const candidates = UNITS[n].filter((i) => {
      const count = popcount(b.cand[i]);
      return count >= 2 && count <= size;
    });
    for (const group of combinations(candidates, size)) {
      const union = group.reduce((mask, i) => mask | b.cand[i], 0);
      if (popcount(union) !== size) continue;
      const removes = present(b, UNITS[n].filter((i) => !group.includes(i)), union);
      if (!removes.length) continue;
      const unit = unitAt(n);
      const name = unitName(unit);
      const digits = digitsIn(union);
      return {
        technique,
        cells: group,
        unit,
        removes,
        relies: absent(b, group, ALL & ~union),
        because: `${technique}: in ${name}, these ${COUNT[size]} squares hold only ${listOf(digits, 'and')}, so the rest of ${name} can't be ${listOf(digits, 'or')}.`,
      };
    }
  }
  return null;
}

function hiddenSubset(b: Board, size: number, technique: string): TipStep | null {
  for (let n = 0; n < UNITS.length; n++) {
    const fitting = DIGITS.filter((d) => {
      const count = where(b, UNITS[n], d).length;
      return count >= 1 && count <= size;
    });
    for (const group of combinations(fitting, size)) {
      const mask = group.reduce((m, d) => m | bitOf(d), 0);
      const cells = UNITS[n].filter((i) => b.cand[i] & mask);
      if (cells.length !== size) continue;
      const removes = present(b, cells, ALL & ~mask);
      if (!removes.length) continue;
      const unit = unitAt(n);
      return {
        technique,
        cells,
        unit,
        removes,
        relies: absent(b, UNITS[n].filter((i) => !cells.includes(i)), mask),
        because: `${technique}: in ${unitName(unit)}, ${listOf(group, 'and')} only fit in these ${COUNT[size]} squares, so those squares can't be anything else.`,
      };
    }
  }
  return null;
}

// X-Wing (size 2) and Swordfish (size 3).
function fish(b: Board, size: number, technique: string): TipStep | null {
  const ways = [
    { lines: ROWS, crossing: COLS, crossOf: (i: number) => i % 9, base: 'rows', across: 'columns' },
    { lines: COLS, crossing: ROWS, crossOf: (i: number) => Math.floor(i / 9), base: 'columns', across: 'rows' },
  ];
  for (const { lines, crossing, crossOf, base, across } of ways) {
    for (const digit of DIGITS) {
      const fitting = nine.filter((n) => {
        const count = where(b, lines[n], digit).length;
        return count >= 2 && count <= size;
      });
      for (const group of combinations(fitting, size)) {
        const cells = group.flatMap((n) => where(b, lines[n], digit));
        const crosses = [...new Set(cells.map(crossOf))].sort((x, y) => x - y);
        if (crosses.length !== size) continue;
        const baseCells = group.flatMap((n) => lines[n]);
        const rest = crosses.flatMap((c) => crossing[c]).filter((i) => !baseCells.includes(i));
        const removes = present(b, rest, bitOf(digit));
        if (!removes.length) continue;
        return {
          technique,
          cells,
          removes,
          relies: absent(b, baseCells.filter((i) => !crosses.includes(crossOf(i))), bitOf(digit)),
          because: `${technique}: in ${base} ${listOf(group.map((n) => n + 1), 'and')}, ${digit} only fits in ${across} ${listOf(crosses.map((c) => c + 1), 'and')}, so the rest of those ${across} can't be ${digit}.`,
        };
      }
    }
  }
  return null;
}

function xyWing(b: Board): TipStep | null {
  const bivalue = b.cand.flatMap((mask, i) => (popcount(mask) === 2 ? [i] : []));
  for (const pivot of bivalue) {
    const pivotMask = b.cand[pivot];
    const wings = bivalue.filter((i) => PEERS[pivot].has(i) && popcount(b.cand[i] & pivotMask) === 1);
    for (const [a, c] of combinations(wings, 2)) {
      const shared = b.cand[a] & b.cand[c];
      // Each pincer takes a different pivot digit, and the same third digit.
      if (popcount(shared) !== 1 || shared & pivotMask || (b.cand[a] & pivotMask) === (b.cand[c] & pivotMask)) continue;
      const seesBoth = [...PEERS[a]].filter((i) => PEERS[c].has(i) && i !== pivot);
      const removes = present(b, seesBoth, shared);
      if (!removes.length) continue;
      const z = digitsIn(shared)[0];
      const x = digitsIn(b.cand[a] & pivotMask)[0];
      const y = digitsIn(b.cand[c] & pivotMask)[0];
      return {
        technique: 'XY-Wing',
        cells: [pivot, a, c],
        removes,
        relies: [pivot, a, c].flatMap((i) => absent(b, [i], ALL & ~b.cand[i])),
        because: `XY-Wing: ${squareName(pivot)} is ${x} or ${y}. If ${x}, ${squareName(a)} is ${z}; if ${y}, ${squareName(c)} is ${z}. So a square sharing a row, column or box with both can't be ${z}.`,
      };
    }
  }
  return null;
}

// In the order the grader tries them.
const TECHNIQUES: ((b: Board) => TipStep | null)[] = [
  nakedSingle,
  hiddenSingle,
  lockedCandidates,
  (b) => nakedSubset(b, 2, 'Naked Pair'),
  (b) => hiddenSubset(b, 2, 'Hidden Pair'),
  (b) => nakedSubset(b, 3, 'Naked Triple'),
  (b) => hiddenSubset(b, 3, 'Hidden Triple'),
  (b) => fish(b, 2, 'X-Wing'),
  xyWing,
  (b) => fish(b, 3, 'Swordfish'),
];

// From the written digits alone, simplest technique first, until one places a digit. On a
// board the techniques can't finish, the steps stop without a placement.
export function fullChain(values: number[]): TipStep[] {
  const board = candidatesOf(values);
  const steps: TipStep[] = [];
  if (!values.includes(0)) return steps;
  for (;;) {
    let step: TipStep | null = null;
    for (const technique of TECHNIQUES) {
      step = technique(board);
      if (step) break;
    }
    if (!step) return steps;
    steps.push(step);
    if (step.places) return steps;
    for (const { cell, digit } of step.removes) board.cand[cell] &= ~bitOf(digit);
  }
}

// Only the steps the placed digit depends on, walking back from it: a step stays if it removed
// something a later kept step relies on, and only those removals stay with it. A candidate no
// step removed was ruled out by written digits, so it needs nothing kept.
export function tipChain(values: number[]): TipStep[] {
  const steps = fullChain(values);
  if (!steps[steps.length - 1]?.places) return [];
  const key = ({ cell, digit }: Candidate) => cell * 10 + digit;
  const needed = new Set<number>();
  const kept: TipStep[] = [];
  for (const step of [...steps].reverse()) {
    const removes = step.removes.filter((candidate) => needed.has(key(candidate)));
    if (!step.places && !removes.length) continue;
    kept.unshift({ ...step, removes });
    for (const candidate of step.relies) needed.add(key(candidate));
  }
  return kept;
}
