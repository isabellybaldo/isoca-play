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
type Sample = { layout: string; seed: number; tiles: Tile[] };

const ruleCases = rawCases as RuleCase[];
const samples = rawSamples as Sample[];

// Depth-first search over the slot rule, played through the real tap, trying moves
// that make a pair first.
function canWin(tiles: Tile[]): boolean {
  const seen = new Set<string>();
  const kindOf = (id: number) => matchKey(tiles[id].face);
  const search = (s: MahjongState): boolean => {
    if (s.status === 'won') return true;
    if (s.status === 'lost') return false;
    const key = `${s.onBoard.join(',')}|${s.slots.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const held = new Set(s.slots.map(kindOf));
    const free = s.onBoard.filter((id) => isFree(s, id));
    const pairs = free.filter((id) => held.has(kindOf(id)));
    const rest = free.filter((id) => !held.has(kindOf(id)));
    return [...pairs, ...rest].some((id) => search(tap(tap(s, id), id)));
  };
  return search(newGame(tiles));
}

test.each(samples)('$layout sample $seed plays to a win through tap', (s) => {
  expect(canWin(s.tiles)).toBe(true);
});

test('canWin rejects a deal that cannot be won', () => {
  // One tower of ten tiles: the top comes off first, e d c b fill the four slots.
  const tiles: Tile[] = ['a', 'b', 'c', 'd', 'e', 'a', 'b', 'c', 'd', 'e'].map((face, i) => ({
    id: i, x: 0, y: 0, z: i, face,
  }));
  expect(canWin(tiles)).toBe(false);
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
