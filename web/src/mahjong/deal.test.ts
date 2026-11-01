import { expect, test } from 'vitest';
import { makeDeal } from './deal';
import { FACES, LAYOUTS, type Layout } from './layouts';
import { isFree, matchKey, newGame, tap, type MahjongState, type Tile } from './rules';

// Depth-first search over the slot rule, trying moves that make a pair first.
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

test.each(LAYOUTS)('$id deals are winnable under the slot rule', (l) => {
  for (let seed = 1; seed <= 200; seed++) {
    expect(canWin(makeDeal(l, seed))).toBe(true);
  }
}, 120_000);

test('canWin rejects a deal that cannot be won', () => {
  // One tower of ten tiles: the top comes off first, e d c b fill the four slots.
  const tiles: Tile[] = ['a', 'b', 'c', 'd', 'e', 'a', 'b', 'c', 'd', 'e'].map((face, i) => ({
    id: i, x: 0, y: 0, z: i, face,
  }));
  expect(canWin(tiles)).toBe(false);
});

test('same seed gives the same deal, different seeds differ', () => {
  for (const l of LAYOUTS) {
    expect(makeDeal(l, 7)).toEqual(makeDeal(l, 7));
    expect(makeDeal(l, 7)).not.toEqual(makeDeal(l, 8));
  }
});

test('the deal keeps the layout cells and ids', () => {
  for (const l of LAYOUTS) {
    const tiles = makeDeal(l, 3);
    expect(tiles).toHaveLength(l.cells.length);
    tiles.forEach((t, i) => {
      expect(t.id).toBe(i);
      expect({ x: t.x, y: t.y, z: t.z }).toEqual(l.cells[i]);
    });
  }
});

// How many tiles of each match kind a deal holds.
function kindCounts(tiles: Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tiles) counts.set(matchKey(t.face), (counts.get(matchKey(t.face)) ?? 0) + 1);
  return counts;
}

// Tiles far enough apart that all are free, so any number of pairs can be dealt.
const spread = (tiles: number): Layout => ({
  id: 'spread',
  name: 'Spread',
  level: 'easy',
  cells: Array.from({ length: tiles }, (_, i) => ({ x: i * 4, y: 0, z: 0 })),
});

test('there are 42 faces and 36 match kinds', () => {
  expect(new Set(FACES).size).toBe(42);
  expect(new Set(FACES.map(matchKey)).size).toBe(36);
});

test('every match kind appears an even number of times, and only known faces are used', () => {
  for (const l of LAYOUTS) {
    for (const seed of [1, 2, 3]) {
      const tiles = makeDeal(l, seed);
      for (const t of tiles) expect(FACES).toContain(t.face);
      for (const n of kindCounts(tiles).values()) expect(n % 2).toBe(0);
    }
  }
});

test('a layout with fewer pairs than kinds uses a random subset, each kind once', () => {
  const l = spread(20);
  const kinds = (seed: number) => [...kindCounts(makeDeal(l, seed)).keys()].sort();
  for (const seed of [1, 2, 3]) {
    const counts = kindCounts(makeDeal(l, seed));
    expect(counts.size).toBe(10);
    for (const n of counts.values()) expect(n).toBe(2);
  }
  expect(kinds(1)).not.toEqual(kinds(2));
});

test('a layout with more pairs than kinds reuses them evenly', () => {
  for (const seed of [1, 2, 3]) {
    const counts = kindCounts(makeDeal(spread(100), seed)); // 50 pairs over 36 kinds
    expect(counts.size).toBe(36);
    for (const n of counts.values()) expect([2, 4]).toContain(n);
  }
});

test('a season or flower pair uses two different faces from its group', () => {
  let seen = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const faces = makeDeal(spread(40), seed).map((t) => t.face);
    for (const kind of ['season', 'flower']) {
      const group = faces.filter((f) => matchKey(f) === kind);
      if (group.length === 0) continue;
      seen++;
      expect(group).toHaveLength(2);
      expect(group[0]).not.toBe(group[1]);
    }
  }
  expect(seen).toBeGreaterThan(0);
});

test('a suit tile, critter or sweet pair is two of the same face', () => {
  const faces = makeDeal(spread(72), 9).map((t) => t.face);
  for (const face of ['circle1', 'bamboo1', 'star1', 'cat', 'heart']) {
    expect(faces.filter((f) => f === face)).toHaveLength(2);
  }
});
