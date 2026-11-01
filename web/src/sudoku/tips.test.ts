import { describe, expect, test } from 'vitest';
import rawCases from '../../../shared/tip-cases.json';
import { fullChain, tipChain, type Candidate, type TipStep } from './tips';

type TipCase = { givens: string; solution: string; tips: string };

const cases = rawCases as TipCase[];

// In the order of TECHNIQUES in tools/sudoku_grader.py, which the fixture's indices count.
const NAMES = [
  'Naked Single',
  'Hidden Single',
  'Locked Candidates',
  'Naked Pair',
  'Hidden Pair',
  'Naked Triple',
  'Hidden Triple',
  'X-Wing',
  'XY-Wing',
  'Swordfish',
];

const written = (text: string) => [...text].map((ch) => (ch === '.' ? 0 : Number(ch)));

// The candidates left by the written digits alone, worked out here apart from the engine.
function freshCandidates(values: number[]): Set<number>[] {
  const sees = (a: number, b: number) =>
    a % 9 === b % 9 ||
    Math.floor(a / 9) === Math.floor(b / 9) ||
    (Math.floor(a / 27) === Math.floor(b / 27) && Math.floor((a % 9) / 3) === Math.floor((b % 9) / 3));
  return values.map((value, cell) => {
    if (value) return new Set<number>();
    const left = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    values.forEach((other, peer) => {
      if (other && sees(cell, peer)) left.delete(other);
    });
    return left;
  });
}

// Every digit in these cells: the shape of most entries in the worked cases below.
const each = (cells: number[], digits: number[]): Candidate[] =>
  cells.flatMap((cell) => digits.map((digit) => ({ cell, digit })));
const others = (...digits: number[]) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !digits.includes(d));
const sorted = (list: Candidate[]) => [...list].sort((a, b) => a.cell - b.cell || a.digit - b.digit);

describe('against the grader, on the whole pack', () => {
  test('every tip names the same techniques and places the same digit', { timeout: 120_000 }, () => {
    expect(cases).toHaveLength(900);
    for (const { givens, solution, tips } of cases) {
      const values = written(givens);
      for (const tip of tips.split(',')) {
        const chain = fullChain(values);
        expect(chain.map((step) => step.technique)).toEqual(
          [...tip.slice(0, -3)].map((index) => NAMES[Number(index)]),
        );
        const cell = Number(tip.slice(-3, -1));
        const digit = Number(tip.slice(-1));
        expect(chain[chain.length - 1].places).toEqual({ cell, digit });
        values[cell] = digit;
      }
      expect(values.join('')).toBe(solution);
      expect(fullChain(values)).toEqual([]);
    }
  });

  test('each step is sound and honest about what it took and relied on', { timeout: 120_000 }, () => {
    for (const { givens, solution, tips } of cases) {
      const values = written(givens);
      for (const tip of tips.split(',')) {
        const chain = fullChain(values);
        const left = freshCandidates(values);
        chain.forEach((step, n) => {
          for (const { cell, digit } of step.relies) {
            expect(left[cell].has(digit), `${step.technique} relies on ${digit} gone from ${cell}`).toBe(false);
          }
          const last = n === chain.length - 1;
          expect(step.places !== undefined).toBe(last);
          expect(step.removes.length === 0).toBe(last);
          if (step.places) expect(left[step.places.cell].has(step.places.digit)).toBe(true);
          for (const { cell, digit } of step.removes) {
            expect(Number(solution[cell])).not.toBe(digit);
            expect(left[cell].has(digit), `${step.technique} removes ${digit} from ${cell}`).toBe(true);
            left[cell].delete(digit);
          }
        });
        values[Number(tip.slice(-3, -1))] = Number(tip.slice(-1));
      }
    }
  });
});

// One board per technique, from the pack, where it is the first thing to fire unless `at` says
// otherwise. The answers were read off the grader's candidates at that point.
const WORKED: { name: string; board: string; at?: number; step: TipStep }[] = [
  {
    name: 'Naked Single',
    board: '.....42.8.1.....5..7.1..34..827.963.6..423.813.1..8.7.7....1.93...5.682.92...7.6.',
    step: {
      technique: 'Naked Single',
      cells: [0],
      removes: [],
      places: { cell: 0, digit: 5 },
      relies: each([0], others(5)),
      because: 'Naked Single: only 5 fits in row 1, column 1.',
    },
  },
  {
    name: 'Hidden Single',
    board: '5....421881...275.27.1.534.4827196356574239813916584727....15931..5.682792...7164',
    step: {
      technique: 'Hidden Single',
      cells: [4],
      unit: { kind: 'row', index: 0 },
      removes: [],
      places: { cell: 4, digit: 7 },
      relies: each([1, 2, 3], [7]),
      because: 'Hidden Single: in row 1, 7 only fits here.',
    },
  },
  {
    name: 'Locked Candidates, pointing',
    board: '3718245.....3.1.84.84.5..314...1.87.91...8...8.7..5.1.1.8.6.3.....183....325.91.8',
    step: {
      technique: 'Locked Candidates',
      cells: [10, 11],
      unit: { kind: 'box', index: 0 },
      removes: each([13, 15], [9]),
      relies: each([9, 18], [9]),
      because: "Locked Candidates: in box 1, 9 only fits in row 2, so the rest of row 2 can't be 9.",
    },
  },
  {
    name: 'Locked Candidates, claiming',
    board: '4.76..1939.....45..1..4.28.8...6.74...2.748.5.748..6..7415..368..64879212..316574',
    step: {
      technique: 'Locked Candidates',
      cells: [30, 32],
      unit: { kind: 'row', index: 3 },
      removes: each([39, 50], [1]),
      relies: each([28, 29, 35], [1]),
      because: "Locked Candidates: in row 4, 1 only fits in box 5, so the rest of box 5 can't be 1.",
    },
  },
  {
    name: 'Naked Pair',
    board: '721854963384796251..5312478..94...87.48.7.53...7.......532......726...1.4.6....2.',
    step: {
      technique: 'Naked Pair',
      cells: [39, 41],
      unit: { kind: 'row', index: 4 },
      removes: [{ cell: 36, digit: 1 }, { cell: 44, digit: 9 }],
      relies: each([39, 41], others(1, 9)),
      because: "Naked Pair: in row 5, these two squares hold only 1 and 9, so the rest of row 5 can't be 1 or 9.",
    },
  },
  {
    name: 'Hidden Pair',
    board: '.46.2.5..2..456..9..5.7....5..6.9....917.2..53.4185.9...2514983..32974564593682..',
    step: {
      technique: 'Hidden Pair',
      cells: [25, 26],
      unit: { kind: 'row', index: 2 },
      removes: [...each([25], [1, 3, 6]), ...each([26], [1, 8])],
      relies: each([18, 19, 21, 23, 24], [2, 4]),
      because: "Hidden Pair: in row 3, 2 and 4 only fit in these two squares, so those squares can't be anything else.",
    },
  },
  {
    name: 'Naked Triple',
    board: '7.3489..16.83.174.4.1.6..38976.....353.......18.6.3.75817936254265814397349275186',
    step: {
      technique: 'Naked Triple',
      cells: [38, 40, 44],
      unit: { kind: 'row', index: 4 },
      removes: [{ cell: 41, digit: 2 }, ...each([42], [4, 9]), { cell: 43, digit: 2 }],
      relies: each([38, 40, 44], others(2, 4, 9)),
      because: "Naked Triple: in row 5, these three squares hold only 2, 4 and 9, so the rest of row 5 can't be 2, 4 or 9.",
    },
  },
  {
    name: 'Hidden Triple',
    board: '1.6498.5....71..6...7.2...9.65.72...718.5...2.......75.5.2873.66......28...96.5..',
    step: {
      technique: 'Hidden Triple',
      cells: [48, 50, 51],
      unit: { kind: 'row', index: 5 },
      removes: [{ cell: 48, digit: 3 }, ...each([50], [3, 4, 9]), ...each([51], [4, 9])],
      relies: each([45, 46, 47, 49], [1, 6, 8]),
      because: "Hidden Triple: in row 6, 1, 6 and 8 only fit in these three squares, so those squares can't be anything else.",
    },
  },
  {
    name: 'X-Wing',
    board: '612849573.7425...19.51..24.2986157345634..12.7413.2..51.69.43574.75.1.8..5976.412',
    step: {
      technique: 'X-Wing',
      cells: [9, 14, 72, 77],
      removes: [{ cell: 23, digit: 3 }],
      relies: each([15, 16], [3]),
      because: "X-Wing: in rows 2 and 9, 3 only fits in columns 1 and 6, so the rest of those columns can't be 3.",
    },
  },
  {
    name: 'X-Wing on columns',
    board: '1.695....2.416.95.75923..1...58731....3516....17429.35578.42.91.41.95728..27815..',
    at: 3,
    step: {
      technique: 'X-Wing',
      cells: [28, 73, 34, 79],
      removes: each([27, 35, 72, 80], [6]),
      relies: each([1, 10, 37, 7, 43], [6]),
      because: "X-Wing: in columns 2 and 8, 6 only fits in rows 4 and 9, so the rest of those rows can't be 6.",
    },
  },
  {
    name: 'XY-Wing',
    board: '9..1......2.967..36..4..9..418596732736241589592378.1.26.839.75357614298..97253..',
    step: {
      technique: 'XY-Wing',
      cells: [19, 9, 26],
      removes: each([15, 20], [1]),
      relies: [...each([19], others(7, 8)), ...each([9], others(1, 8)), ...each([26], others(1, 7))],
      because:
        "XY-Wing: row 3, column 2 is 8 or 7. If 8, row 2, column 1 is 1; if 7, row 3, column 9 is 1. So a square sharing a row, column or box with both can't be 1.",
    },
  },
  {
    name: 'Swordfish',
    board: '279584316168.9.2455341..879.159..4..42..58197.974.15..742819653.81..592495.24.781',
    step: {
      technique: 'Swordfish',
      cells: [12, 14, 38, 39, 74, 77],
      removes: each([32, 66], [3]),
      relies: [],
      because: "Swordfish: in rows 2, 5 and 9, 3 only fits in columns 3, 4 and 6, so the rest of those columns can't be 3.",
    },
  },
  {
    // Row 2 has two more empty squares. Column 6's is on a crossing line, so it isn't relied on.
    name: 'Swordfish with other empty squares on its rows',
    board: '741658.2..6..9.147239417856.9718.4323..924.71124.7..8.4..761.9.91.83.764.7..49.1.',
    step: {
      technique: 'Swordfish',
      cells: [9, 11, 27, 32, 65, 68],
      removes: each([38, 50, 56, 72, 74], [5]),
      relies: each([12], [5]),
      because: "Swordfish: in rows 2, 4 and 8, 5 only fits in columns 1, 3 and 6, so the rest of those columns can't be 5.",
    },
  },
];

describe.each(WORKED)('$name', ({ board, at, step }) => {
  test('is the step, as worked out by hand', () => {
    const got = fullChain(written(board))[at ?? 0];
    expect(got.technique).toBe(step.technique);
    expect(got.cells).toEqual(step.cells);
    expect(got.unit).toEqual(step.unit);
    expect(got.because).toBe(step.because);
    expect(got.places).toEqual(step.places);
    expect(sorted(got.removes)).toEqual(sorted(step.removes));
    expect(sorted(got.relies)).toEqual(sorted(step.relies));
  });
});

test('a full board has no tip', () => {
  expect(fullChain(written(cases[0].solution))).toEqual([]);
});

// Worked out here apart from the engine, like freshCandidates: why a kept step still holds
// when only the kept steps have run.
const rowOf = (i: number) => Math.floor(i / 9);
const colOf = (i: number) => i % 9;
const boxOf = (i: number) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
const sees = (a: number, b: number) => a !== b && (rowOf(a) === rowOf(b) || colOf(a) === colOf(b) || boxOf(a) === boxOf(b));
const ALL_CELLS = Array.from({ length: 81 }, (_, i) => i);
const ALL_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const unitCells = ({ kind, index }: NonNullable<TipStep['unit']>) =>
  ALL_CELLS.filter((i) => (kind === 'row' ? rowOf(i) : kind === 'column' ? colOf(i) : boxOf(i)) === index);
const spots = (left: Set<number>[], cells: number[], digit: number) => cells.filter((i) => left[i].has(digit));
const within = (some: number[], all: number[]) => some.every((x) => all.includes(x));

function fishHolds(left: Set<number>[], cells: number[], digit: number, gone: number[], base: (i: number) => number, cross: (i: number) => number) {
  const bases = [...new Set(cells.map(base))];
  const crosses = [...new Set(cells.map(cross))];
  return (
    bases.length === crosses.length &&
    bases.every((b) => {
      const places = spots(left, ALL_CELLS.filter((i) => base(i) === b), digit);
      return places.length > 0 && within(places.map(cross), crosses);
    }) &&
    gone.every((i) => crosses.includes(cross(i)) && !bases.includes(base(i)))
  );
}

function holds(step: TipStep, left: Set<number>[]): boolean {
  const { technique, cells, unit, removes, places } = step;
  const gone = removes.map((r) => r.cell);
  const digit = removes[0]?.digit;
  const oneDigit = removes.every((r) => r.digit === digit);
  switch (technique) {
    case 'Naked Single':
      return left[places!.cell].size === 1 && left[places!.cell].has(places!.digit);
    case 'Hidden Single': {
      const only = spots(left, unitCells(unit!), places!.digit);
      return only.length === 1 && only[0] === places!.cell;
    }
    case 'Locked Candidates': {
      const inUnit = spots(left, unitCells(unit!), digit);
      return oneDigit && inUnit.length > 0 && within(inUnit, cells) && gone.every((i) => !inUnit.includes(i) && inUnit.every((c) => sees(i, c)));
    }
    case 'Naked Pair':
    case 'Naked Triple': {
      const inUnit = unitCells(unit!);
      const held = new Set(cells.flatMap((i) => [...left[i]]));
      return (
        within(cells, inUnit) &&
        held.size === cells.length &&
        removes.every((r) => held.has(r.digit) && inUnit.includes(r.cell) && !cells.includes(r.cell))
      );
    }
    case 'Hidden Pair':
    case 'Hidden Triple': {
      const inUnit = unitCells(unit!);
      const locked = ALL_DIGITS.filter((d) => {
        const at = spots(left, inUnit, d);
        return at.length > 0 && within(at, cells);
      });
      return within(cells, inUnit) && locked.length >= cells.length && removes.every((r) => cells.includes(r.cell) && !locked.includes(r.digit));
    }
    case 'X-Wing':
    case 'Swordfish':
      return oneDigit && (fishHolds(left, cells, digit, gone, rowOf, colOf) || fishHolds(left, cells, digit, gone, colOf, rowOf));
    case 'XY-Wing': {
      const [pivot, a, c] = cells;
      if ([pivot, a, c].some((i) => left[i].size !== 2) || !sees(pivot, a) || !sees(pivot, c)) return false;
      const shared = [...left[a]].filter((d) => left[c].has(d));
      if (shared.length !== 1 || left[pivot].has(shared[0])) return false;
      const x = [...left[a]].find((d) => d !== shared[0])!;
      const y = [...left[c]].find((d) => d !== shared[0])!;
      return (
        x !== y &&
        left[pivot].has(x) &&
        left[pivot].has(y) &&
        oneDigit &&
        digit === shared[0] &&
        gone.every((i) => sees(i, a) && sees(i, c) && i !== pivot)
      );
    }
    default:
      throw new Error(`no proof written for ${technique}`);
  }
}

const has = (list: Candidate[], { cell, digit }: Candidate) => list.some((r) => r.cell === cell && r.digit === digit);

describe('tipChain, on the whole pack', () => {
  test('keeps only the steps its number needs, and those are enough', { timeout: 300_000 }, () => {
    let tipCount = 0;
    let oneStep = 0;
    let oneStepBefore = 0;
    let longest = 0;
    let longestBefore = 0;
    for (const { givens, tips } of cases) {
      const values = written(givens);
      for (const tip of tips.split(',')) {
        const full = fullChain(values);
        const kept = tipChain(values);
        const name = `${values.join('')} tip ${tip}`;

        tipCount += 1;
        if (kept.length === 1) oneStep += 1;
        if (full.length === 1) oneStepBefore += 1;
        longest = Math.max(longest, kept.length);
        longestBefore = Math.max(longestBefore, full.length);

        expect(kept[kept.length - 1].places, name).toEqual(full[full.length - 1].places);
        if (full.length === 1) expect(kept, name).toEqual(full);

        // A subsequence of the full chain, each step as it was but for removes it doesn't need.
        let from = 0;
        for (const step of kept) {
          const found = full.findIndex(
            (other, n) =>
              n >= from &&
              other.technique === step.technique &&
              other.because === step.because &&
              JSON.stringify(other.cells) === JSON.stringify(step.cells) &&
              JSON.stringify(other.relies) === JSON.stringify(step.relies) &&
              step.removes.every((r) => has(other.removes, r)),
          );
          expect(found, `${name}: ${step.technique} out of order`).toBeGreaterThanOrEqual(0);
          from = found + 1;
        }

        // Replayed from the written digits alone, with only what was kept.
        const left = freshCandidates(values);
        kept.forEach((step, n) => {
          for (const { cell, digit } of step.relies) {
            expect(left[cell].has(digit), `${name}: ${step.technique} relies on ${digit} gone from ${cell}`).toBe(false);
          }
          expect(holds(step, left), `${name}: ${step.technique} ${step.cells} no longer holds`).toBe(true);
          const later = kept.slice(n + 1).flatMap((other) => other.relies);
          if (!step.places) expect(step.removes.length, `${name}: ${step.technique} kept for nothing`).toBeGreaterThan(0);
          for (const removed of step.removes) {
            expect(left[removed.cell].has(removed.digit), `${name}: ${step.technique} removes ${removed.digit} from ${removed.cell}`).toBe(true);
            expect(has(later, removed), `${name}: nothing later needs ${removed.digit} gone from ${removed.cell}`).toBe(true);
            left[removed.cell].delete(removed.digit);
          }
        });

        values[Number(tip.slice(-3, -1))] = Number(tip.slice(-1));
      }
    }
    console.log(
      `tips: ${tipCount}; longest chain ${longestBefore} -> ${longest}; ` +
        `one-step ${((100 * oneStepBefore) / tipCount).toFixed(1)}% -> ${((100 * oneStep) / tipCount).toFixed(1)}%`,
    );
  });
});

describe('tipChain with nothing to place', () => {
  test('is empty when the techniques stall, whatever they removed on the way', () => {
    // Box 1's last column holds only 1, 8 and 9, which clears them from that column; then nothing fires.
    const stalled = written('23.......45.......67' + '.'.repeat(61));
    const full = fullChain(stalled);
    expect(full.length).toBeGreaterThan(0);
    expect(full.some((step) => step.places)).toBe(false);
    expect(tipChain(stalled)).toEqual([]);
  });

  test('is empty on a full board and on a blank one', () => {
    expect(tipChain(written(cases[0].solution))).toEqual([]);
    expect(tipChain(written('.'.repeat(81)))).toEqual([]);
  });
});
