import { describe, expect, test } from 'vitest';
import rawCases from '../../../shared/solitaire-cases.json';
import {
  applyMove,
  canMove,
  isHistoryEntry,
  move,
  newSolitaire,
  sendUp,
  tapPile,
  undo,
  type Column,
  type SolitaireState,
} from './rules';

// Suits: 0 heart, 1 diamond, 2 club, 3 spade. Hearts and diamonds are red.
const card = (suit: number, rank: number): number => suit * 13 + rank - 1;
const H = (rank: number) => card(0, rank);
const D = (rank: number) => card(1, rank);
const C = (rank: number) => card(2, rank);
const S = (rank: number) => card(3, rank);

const identityDeal = Array.from({ length: 52 }, (_, i) => i);

// A position built by hand: only the parts a test names are filled in.
function pos(parts: {
  columns?: Partial<Column>[];
  stock?: number[];
  waste?: number[];
  foundations?: number[];
}): SolitaireState {
  const columns: Column[] = Array.from({ length: 7 }, (_, i) => ({
    down: parts.columns?.[i]?.down ?? [],
    up: parts.columns?.[i]?.up ?? [],
  }));
  return {
    deal: identityDeal,
    stock: parts.stock ?? [],
    waste: parts.waste ?? [],
    columns,
    foundations: parts.foundations ?? [0, 0, 0, 0],
    history: [],
    status: 'playing',
  };
}

describe('setup and the pile', () => {
  test('deals seven columns and a pile of 24', () => {
    const s = newSolitaire(identityDeal);
    expect(s.columns.map((c) => c.down.length)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(s.columns.map((c) => c.up)).toEqual([[0], [2], [5], [9], [14], [20], [27]]);
    expect(s.columns[6].down).toEqual([21, 22, 23, 24, 25, 26]);
    expect(s.stock).toEqual(identityDeal.slice(28));
    expect(s.stock).toHaveLength(24);
    expect(s.waste).toEqual([]);
    expect(s.foundations).toEqual([0, 0, 0, 0]);
    expect(s.history).toEqual([]);
    expect(s.status).toBe('playing');
  });

  test('tapping turns one card and an empty pile turns back in the original order', () => {
    let s = pos({ stock: [5, 6, 7] });
    s = tapPile(s);
    expect(s.waste).toEqual([5]);
    expect(s.stock).toEqual([6, 7]);
    s = tapPile(tapPile(s));
    expect(s.waste).toEqual([5, 6, 7]);
    expect(s.stock).toEqual([]);
    const back = tapPile(s);
    expect(back.stock).toEqual([5, 6, 7]);
    expect(back.waste).toEqual([]);
    expect(back.history).toEqual(['d', 'd', 'd', 'r']);
    expect(tapPile(tapPile(back)).waste).toEqual([5, 6]);
    const empty = pos({});
    expect(tapPile(empty)).toBe(empty);
  });
});

describe('columns', () => {
  test('alternating colours one rank down lands', () => {
    const s = pos({ columns: [{ up: [S(7)] }, { up: [H(8)] }] });
    expect(canMove(s, 'c0', 'c1', 1)).toBe(true);
    const next = move(s, 'c0', 'c1', 1);
    expect(next.columns[1].up).toEqual([H(8), S(7)]);
    expect(next.columns[0].up).toEqual([]);
    expect(next.history).toEqual(['c0>c1:1']);
    const fromPile = move(pos({ columns: [{ up: [H(8)] }], waste: [3, C(7)] }), 'w', 'c0', 1);
    expect(fromPile.columns[0].up).toEqual([H(8), C(7)]);
    expect(fromPile.waste).toEqual([3]);
  });

  test('same colour or wrong rank returns the same object', () => {
    const s = pos({ columns: [{ up: [S(7)] }, { up: [C(8)] }, { up: [H(9)] }, { up: [D(8)] }] });
    expect(move(s, 'c0', 'c1', 1)).toBe(s); // same colour
    expect(move(s, 'c0', 'c2', 1)).toBe(s); // two ranks down
    expect(move(s, 'c3', 'c0', 1)).toBe(s); // rank up
    expect(move(s, 'c0', 'c0', 1)).toBe(s); // onto itself
    expect(move(s, 'c0', 'c1', 2)).toBe(s); // more than there is
    expect(move(s, 'c0', 'c1', 0)).toBe(s);
    expect(canMove(s, 'c0', 'c1', 1)).toBe(false);
  });

  test('only a king or a run headed by a king starts an empty column', () => {
    const s = pos({
      columns: [{ up: [H(5)] }, { up: [S(13), D(12)] }, { up: [C(12), H(11)] }],
    });
    expect(move(s, 'c0', 'c3', 1)).toBe(s);
    expect(move(s, 'c2', 'c3', 2)).toBe(s);
    expect(move(s, 'c2', 'c3', 1)).toBe(s);
    const king = move(s, 'c1', 'c3', 2);
    expect(king.columns[3].up).toEqual([S(13), D(12)]);
    const lone = move(pos({ columns: [{ up: [S(13)] }], waste: [D(13)] }), 'w', 'c1', 1);
    expect(lone.columns[1].up).toEqual([D(13)]);
  });

  test('a run moves together', () => {
    const s = pos({ columns: [{ up: [S(9), H(8), C(7)] }, { up: [D(10)] }] });
    expect(move(s, 'c0', 'c1', 1)).toBe(s); // the club 7 alone is on a 10
    const next = move(s, 'c0', 'c1', 3);
    expect(next.columns[1].up).toEqual([D(10), S(9), H(8), C(7)]);
    const part = move(pos({ columns: [{ up: [S(9), H(8), C(7)] }, { up: [D(8)] }] }), 'c0', 'c1', 1);
    expect(part.columns[1].up).toEqual([D(8), C(7)]);
    expect(part.columns[0].up).toEqual([S(9), H(8)]);
  });

  test('uncovering a face-down card turns it over in the same move', () => {
    const s = pos({ columns: [{ down: [3, D(2)], up: [S(7)] }, { up: [H(8)] }] });
    const next = move(s, 'c0', 'c1', 1);
    expect(next.columns[0].down).toEqual([3]);
    expect(next.columns[0].up).toEqual([D(2)]);
    expect(next.history).toEqual(['c0>c1:1!']);
    // A run that leaves a face-up card behind turns nothing over.
    const stays = move(pos({ columns: [{ down: [3], up: [H(9), S(8)] }, { up: [D(9)] }] }), 'c0', 'c1', 1);
    expect(stays.columns[0]).toEqual({ down: [3], up: [H(9)] });
    expect(stays.history).toEqual(['c0>c1:1']);
    // The whole run leaving does.
    const all = move(pos({ columns: [{ down: [3], up: [H(9), S(8)] }, { up: [C(10)] }] }), 'c0', 'c1', 2);
    expect(all.columns[0]).toEqual({ down: [], up: [3] });
    expect(all.history).toEqual(['c0>c1:2!']);
  });
});

describe('answer piles', () => {
  test('answer piles go ace up by suit', () => {
    const s = pos({ columns: [{ up: [S(2)] }, { up: [D(1)] }, { up: [H(1)] }], foundations: [0, 0, 0, 0] });
    expect(move(s, 'c0', 'f3', 1)).toBe(s); // a 2 on an empty pile
    expect(move(s, 'c1', 'f0', 1)).toBe(s); // the wrong suit
    const one = move(s, 'c2', 'f0', 1);
    expect(one.foundations).toEqual([1, 0, 0, 0]);
    expect(one.columns[2].up).toEqual([]);
    expect(one.history).toEqual(['c2>f0:1']);
    const two = move(pos({ columns: [{ up: [H(2)] }], foundations: [1, 0, 0, 0] }), 'c0', 'f0', 1);
    expect(two.foundations[0]).toBe(2);
    const fromPile = move(pos({ waste: [S(1)] }), 'w', 'f3', 1);
    expect(fromPile.foundations).toEqual([0, 0, 0, 1]);
    expect(fromPile.waste).toEqual([]);
  });

  test('the top of an answer pile moves back to a column', () => {
    const s = pos({ columns: [{ up: [S(4)] }], foundations: [3, 0, 0, 0] });
    const next = move(s, 'f0', 'c0', 1);
    expect(next.foundations).toEqual([2, 0, 0, 0]);
    expect(next.columns[0].up).toEqual([S(4), H(3)]);
    expect(next.history).toEqual(['f0>c0:1']);
    expect(move(pos({ columns: [{ up: [H(4)] }], foundations: [3, 0, 0, 0] }), 'f0', 'c0', 1).foundations[0]).toBe(3);
    const empty = pos({ foundations: [0, 0, 0, 0] });
    expect(move(empty, 'f0', 'c0', 1)).toBe(empty);
    const king = move(pos({ foundations: [0, 0, 0, 13] }), 'f3', 'c2', 1);
    expect(king.columns[2].up).toEqual([S(13)]);
  });

  test('only one card at a time goes to an answer pile', () => {
    const s = pos({ columns: [{ up: [S(2), H(1)] }], foundations: [0, 0, 0, 1] });
    expect(move(s, 'c0', 'f3', 2)).toBe(s);
    expect(move(s, 'c0', 'f0', 2)).toBe(s);
    const f = pos({ foundations: [2, 0, 0, 0] });
    expect(move(f, 'f0', 'f1', 1)).toBe(f);
  });

  test('sendUp refuses a card that cannot go', () => {
    const s = pos({ columns: [{ up: [H(2)] }], waste: [S(5)], foundations: [0, 0, 0, 0] });
    expect(sendUp(s, 'c0')).toBe(s);
    expect(sendUp(s, 'w')).toBe(s);
    expect(sendUp(s, 'c3')).toBe(s); // empty
    expect(sendUp(s, 'f0')).toBe(s);
    const ok = pos({ columns: [{ down: [3], up: [H(1)] }], waste: [S(1)] });
    const a = sendUp(ok, 'c0');
    expect(a.foundations).toEqual([1, 0, 0, 0]);
    expect(a.columns[0].up).toEqual([3]);
    expect(a.history).toEqual(['c0>f0:1!']);
    const b = sendUp(ok, 'w');
    expect(b.foundations).toEqual([0, 0, 0, 1]);
    expect(b.history).toEqual(['w>f3:1']);
  });
});

describe('undo', () => {
  test('undo restores a turned-over card to face down', () => {
    const s = pos({ columns: [{ down: [3, D(2)], up: [S(7)] }, { up: [H(8)] }] });
    const back = undo(move(s, 'c0', 'c1', 1));
    expect(back).toEqual(s);
  });

  test("undo of 'r' and of 'd' restores the piles", () => {
    const s = pos({ stock: [5, 6] });
    const turned = tapPile(tapPile(s));
    const back = tapPile(turned);
    expect(back.history).toEqual(['d', 'd', 'r']);
    const noR = undo(back);
    expect(noR.stock).toEqual([]);
    expect(noR.waste).toEqual([5, 6]);
    const noD = undo(noR);
    expect(noD.stock).toEqual([6]);
    expect(noD.waste).toEqual([5]);
    expect(undo(noD)).toEqual(s);
  });

  test('undo from an answer pile restores it', () => {
    const s = pos({ columns: [{ up: [S(4)] }], foundations: [3, 0, 0, 0] });
    const down = move(s, 'f0', 'c0', 1);
    expect(undo(down)).toEqual(s);
    const up = pos({ columns: [{ down: [3], up: [H(4)] }], foundations: [3, 0, 0, 0] });
    expect(undo(move(up, 'c0', 'f0', 1))).toEqual(up);
    const w = pos({ waste: [1, D(1)] });
    expect(undo(move(w, 'w', 'f1', 1))).toEqual(w);
  });

  test('undo all the way returns to the starting piles', () => {
    const start = newSolitaire(identityDeal);
    let s = tapPile(tapPile(tapPile(start)));
    expect(s.waste).toHaveLength(3);
    for (const m of ['c0>c2:1', 'c6>c0:1', 'w>c1:1', 'c1>f0:1']) s = applyMove(s, m);
    while (s.history.length) s = undo(s);
    expect(s).toEqual(start);
    expect(undo(s)).toBe(s);
  });
});

describe('winning', () => {
  test('52 on the answer piles is won', () => {
    const s = pos({ columns: [{ up: [S(13)] }], foundations: [13, 13, 13, 12] });
    const won = move(s, 'c0', 'f3', 1);
    expect(won.status).toBe('won');
    expect(won.foundations).toEqual([13, 13, 13, 13]);
    expect(move(pos({ columns: [{ up: [S(12)] }], foundations: [13, 13, 13, 11] }), 'c0', 'f3', 1).status).toBe(
      'playing',
    );
  });

  test('moves are ignored after a win but undo reopens the game', () => {
    const s = pos({ columns: [{ up: [S(13)] }], foundations: [13, 13, 13, 12] });
    const won = move(s, 'c0', 'f3', 1);
    expect(move(won, 'f0', 'c0', 1)).toBe(won);
    expect(tapPile(won)).toBe(won);
    expect(sendUp(won, 'c0')).toBe(won);
    expect(applyMove(won, 'f0>c0:1')).toBe(won);
    const open = undo(won);
    expect(open.status).toBe('playing');
    expect(open).toEqual(s);
  });
});

type Walk = {
  deal: number[];
  steps: { move: string; valid: boolean }[];
  stock: number[];
  waste: number[];
  columns: Column[];
  foundations: number[];
  status: string;
};

describe('shared cases', () => {
  test('the shared walks agree with Python', () => {
    const walks = rawCases as Walk[];
    expect(walks.length).toBeGreaterThan(0);
    for (const walk of walks) {
      let s = newSolitaire(walk.deal);
      for (const step of walk.steps) {
        const next = applyMove(s, step.move);
        expect(next !== s).toBe(step.valid);
        s = next;
      }
      expect(s.stock).toEqual(walk.stock);
      expect(s.waste).toEqual(walk.waste);
      expect(s.columns).toEqual(walk.columns);
      expect(s.foundations).toEqual(walk.foundations);
      expect(s.status).toBe(walk.status);
      while (s.history.length) s = undo(s);
      expect(s).toEqual(newSolitaire(walk.deal));
    }
  });
});

describe('saving', () => {
  test('a game of 20,000 moves saves in under 512 KB', () => {
    let s = newSolitaire(identityDeal);
    for (let i = 0; i < 20_000; i++) s = tapPile(s);
    expect(s.history).toHaveLength(20_000);
    expect(s.history).toContain('r');
    expect(JSON.stringify(s).length).toBeLessThan(512 * 1024);
  });

  test.each(['d', 'r', 'w>c0:1', 'w>f3:1', 'f2>c6:1', 'c3>c5:2', 'c3>c5:12!', 'c0>f0:1!'])('%s is a history entry', (entry) => {
    expect(isHistoryEntry(entry)).toBe(true);
  });

  test.each(['', 'x', 'dd', 'd!', 'r!', 'c3>c5', 'c3>c5:0', 'c3>c5:-1', 'c7>c5:1', 'c3>w:1', 'w1>c0:1', 'f4>c0:1', 'c3>c5:2!!', 'c3!>c5:2', ' d', 'c3>c5:2\n'])(
    '%j is not a history entry',
    (entry) => {
      expect(isHistoryEntry(entry)).toBe(false);
    },
  );

  test('anything but a string is not a history entry', () => {
    for (const entry of [1, null, undefined, ['d'], {}]) expect(isHistoryEntry(entry)).toBe(false);
  });

  test('every entry the rules write is a history entry', () => {
    for (const walk of rawCases as Walk[]) {
      let s = newSolitaire(walk.deal);
      for (const step of walk.steps) s = applyMove(s, step.move);
      expect(s.history.length).toBeGreaterThan(0);
      expect(s.history.every(isHistoryEntry)).toBe(true);
    }
  });
});
