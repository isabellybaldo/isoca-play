import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { newSolitaire, tapPile, move, type SolitaireState, type Column } from './rules';
import { tipFor } from './tips';

// Read when the test runs, not imported: tsc checks the tests too, and the image's web stage
// has only web/ and shared/. CI runs the tests from the checkout, where this file is.
const PACK_FILE = join(import.meta.dirname, '..', '..', '..', 'server', 'isoca_play', 'data', 'solitaire_pack.json');
const pack = JSON.parse(readFileSync(PACK_FILE, 'utf8'));

const h = (r: number) => r - 1;
const d = (r: number) => 13 + r - 1;
const c = (r: number) => 26 + r - 1;
const s = (r: number) => 39 + r - 1;

// Seven columns of lone nines, which fit nothing and go nowhere; tests change what they need.
function table(over: Partial<SolitaireState> & { cols?: Record<number, Column> } = {}): SolitaireState {
  const nines = [h(9), d(9), c(9), s(9), h(9), d(9), c(9)];
  const columns: Column[] = nines.map((card) => ({ down: [], up: [card] }));
  for (const [i, col] of Object.entries(over.cols ?? {})) columns[Number(i)] = col;
  const { cols: _cols, ...rest } = over;
  return {
    deal: [],
    stock: [],
    waste: [],
    columns,
    foundations: [0, 0, 0, 0],
    history: [],
    status: 'playing',
    ...rest,
  };
}

describe('tipFor', () => {
  test('turns over a face-down card first', () => {
    const t = table({
      cols: { 0: { down: [d(2)], up: [s(6)] }, 1: { down: [], up: [h(7)] } },
      waste: [h(1)],
    });
    const tip = tipFor(t);
    expect(tip).toMatchObject({ kind: 'move', from: 'c0', to: 'c1', n: 1 });
  });

  test('a run headed by the first face-up card moves whole', () => {
    const t = table({
      cols: { 0: { down: [d(2)], up: [s(6), h(5)] }, 1: { down: [], up: [h(7)] } },
    });
    expect(tipFor(t)).toMatchObject({ kind: 'move', from: 'c0', to: 'c1', n: 2 });
  });

  test('a single card with a face-down card under it can go to an answer pile', () => {
    const t = table({ cols: { 0: { down: [d(2)], up: [h(1)] } } });
    expect(tipFor(t)).toMatchObject({ kind: 'move', from: 'c0', to: 'f0', n: 1 });
  });

  test('a safe move to an answer pile', () => {
    const t = table({ cols: { 0: { down: [], up: [h(1)] } } });
    expect(tipFor(t)).toMatchObject({ kind: 'move', from: 'c0', to: 'f0', n: 1 });
    const w = table({ waste: [d(1)], stock: [0] });
    expect(tipFor(w)).toMatchObject({ kind: 'move', from: 'w', to: 'f1', n: 1 });
  });

  test('aces and twos are always safe', () => {
    const t = table({ foundations: [1, 0, 0, 0], cols: { 0: { down: [], up: [h(2)] } } });
    expect(tipFor(t)).toMatchObject({ kind: 'move', from: 'c0', to: 'f0' });
  });

  test('a card above the safe rank is not tipped by rule 2', () => {
    const t = table({
      foundations: [3, 0, 0, 0],
      cols: { 0: { down: [], up: [h(4)] } },
      stock: [5],
    });
    expect(tipFor(t).kind).toBe('turn');
    const safe = table({
      foundations: [3, 0, 3, 3],
      cols: { 0: { down: [], up: [h(4)] } },
      stock: [5],
    });
    expect(tipFor(safe)).toMatchObject({ kind: 'move', from: 'c0', to: 'f0' });
  });

  test('a king from the pile into an empty column, first when it uncovers a card', () => {
    const t = table({ cols: { 6: { down: [], up: [] } }, waste: [d(3), s(13)], stock: [5] });
    expect(tipFor(t)).toMatchObject({ kind: 'move', from: 'w', to: 'c6', n: 1 });
    const alone = table({ cols: { 6: { down: [], up: [] } }, waste: [s(13)], stock: [5] });
    expect(tipFor(alone)).toMatchObject({ kind: 'move', from: 'w', to: 'c6', n: 1 });
    const bare = table({ cols: { 0: { down: [], up: [s(13), h(12)] }, 6: { down: [], up: [] } }, stock: [5] });
    expect(tipFor(bare).kind).toBe('turn');
  });

  test('a king run with face-down cards under it goes to an empty column', () => {
    const t = table({ cols: { 0: { down: [d(2)], up: [s(13)] }, 6: { down: [], up: [] } } });
    expect(tipFor(t)).toMatchObject({ kind: 'move', from: 'c0', to: 'c6', n: 1 });
  });

  test('any other move from the face-up pile', () => {
    const t = table({ waste: [h(8)], stock: [5] });
    expect(tipFor(t)).toMatchObject({ kind: 'move', from: 'w', to: 'c2', n: 1 });
  });

  test('rule 4 can send the pile card to an answer pile', () => {
    const t = table({ foundations: [3, 0, 0, 0], waste: [h(4)], stock: [5] });
    expect(tipFor(t)).toMatchObject({ kind: 'move', from: 'w', to: 'f0', n: 1 });
  });

  test('a pile king that can go home is tipped', () => {
    const t = table({ foundations: [12, 0, 0, 0], waste: [h(13)], stock: [5] });
    expect(tipFor(t)).toMatchObject({ kind: 'move', from: 'w', to: 'f0', n: 1 });
  });

  test('otherwise turn the pile', () => {
    expect(tipFor(table({ stock: [1, 2] })).kind).toBe('turn');
  });

  test('after a whole pass with no other move, none', () => {
    expect(tipFor(table({ stock: [], waste: [1, 2], history: ['d', 'd'] })).kind).toBe('none');
    expect(tipFor(table({ stock: [], waste: [1, 2], history: ['d', 'r', 'd', 'd'] })).kind).toBe('none');
    expect(tipFor(table({ stock: [3], waste: [1, 2], history: ['c1>c2:1', 'd'] })).kind).toBe('turn');
  });

  test('an empty pile and no move, none', () => {
    expect(tipFor(table()).kind).toBe('none');
  });

  test('a tip never reads the unseen pile', () => {
    const a = table({ stock: [1, 2, 3, 4], waste: [h(8)] });
    const b = table({ stock: [4, 3, 2, 1], waste: [h(8)] });
    expect(tipFor(a)).toEqual(tipFor(b));
    const x = table({ stock: [1, 2, 3, 4] });
    const y = table({ stock: [h(1), d(1), c(1), s(1)] });
    expect(tipFor(x)).toEqual(tipFor(y));
  });

  test('following tips always ends', () => {
    const deals = (pack as { deal: number[] }[]).slice(0, 50);
    expect(deals.length).toBe(50);
    for (const { deal } of deals) {
      let state = newSolitaire(deal);
      let steps = 0;
      while (state.status !== 'won' && steps < 5000) {
        const tip = tipFor(state);
        if (tip.kind === 'none') break;
        const next = tip.kind === 'turn' ? tapPile(state) : move(state, tip.from, tip.to, tip.n);
        expect(next).not.toBe(state);
        state = next;
        steps++;
      }
      expect(steps).toBeLessThan(5000);
    }
  });
});
