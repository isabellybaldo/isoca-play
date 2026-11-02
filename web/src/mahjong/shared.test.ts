import { expect, test } from 'vitest';
import rawCases from '../../../shared/rule-cases.json';
import rawSamples from '../../../shared/deal-samples.json';
import { FACES, LAYOUTS } from './layouts';
import { isCovered, isFree, matchKey, newGame, tap, type MahjongState, type Tile } from './rules';

type RuleCase = {
  name: string;
  tiles: Tile[];
  onBoard: number[];
  covered: number[];
  free: number[];
  matchKeys: Record<string, string>;
};
type Sample = { layout: string; seed: number; tiles: Tile[]; order: number[][] };

const ruleCases = rawCases as RuleCase[];
const samples = rawSamples as Sample[];

// The server's clearing order, played through the real tap. Searching for a win is no test:
// once kinds repeat, wrong turns can take longer to rule out than any run should.
function winsWithSlots(tiles: Tile[], order: number[][]): boolean {
  const end = order.flat().reduce((s, id) => tap(tap(s, id), id), newGame(tiles));
  return end.status === 'won';
}

function winsWithoutSlots(tiles: Tile[], order: number[][]): boolean {
  const end = order.reduce((s, [a, b]) => tap(tap(s, a), b), newGame(tiles, { noSlots: true }));
  return end.status === 'won';
}

test.each(samples)('$layout sample $seed plays to a win through tap', (s) => {
  expect(winsWithSlots(s.tiles, s.order)).toBe(true);
});

test.each(samples)('$layout sample $seed plays to a win without slots', (s) => {
  expect(winsWithoutSlots(s.tiles, s.order)).toBe(true);
});

test('an order that does not clear the board is no win', () => {
  const s = samples[0];
  const short = s.order.slice(0, -1);
  const swapped = [...s.order].reverse();
  expect(winsWithSlots(s.tiles, short)).toBe(false);
  expect(winsWithoutSlots(s.tiles, short)).toBe(false);
  expect(winsWithSlots(s.tiles, swapped)).toBe(false);
  expect(winsWithoutSlots(s.tiles, swapped)).toBe(false);
});

test('there are 20 samples of each layout', () => {
  for (const l of LAYOUTS) expect(samples.filter((s) => s.layout === l.id)).toHaveLength(20);
});

test.each(samples)('$layout sample $seed sits on the layout this app reads, in known faces', (s) => {
  const layout = LAYOUTS.find((l) => l.id === s.layout)!;
  expect(s.tiles.map(({ x, y, z }) => ({ x, y, z }))).toEqual(layout.cells);
  expect(s.tiles.map((t) => t.id)).toEqual(layout.cells.map((_, i) => i));
  for (const t of s.tiles) expect(FACES).toContain(t.face);
});

test.each(ruleCases)('$name matches the shared answer', (c) => {
  const s: MahjongState = { ...newGame(c.tiles), onBoard: c.onBoard };
  expect(c.onBoard.filter((id) => isCovered(s, id))).toEqual(c.covered);
  expect(c.onBoard.filter((id) => isFree(s, id))).toEqual(c.free);
  for (const [face, key] of Object.entries(c.matchKeys)) expect(matchKey(face)).toBe(key);
});

test('there are 42 faces and 36 match kinds', () => {
  expect(new Set(FACES).size).toBe(42);
  expect(new Set(FACES.map(matchKey)).size).toBe(36);
});
