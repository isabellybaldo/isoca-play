import { expect, test } from 'vitest';
import { makeDeal } from './deal';
import { FACES, LAYOUTS } from './layouts';
import { isFree, newGame, tap, type MahjongState, type Tile } from './rules';

// Depth-first search over the slot rule, trying moves that make a pair first.
function canWin(tiles: Tile[]): boolean {
  const seen = new Set<string>();
  const faceOf = (id: number) => tiles[id].face;
  const search = (s: MahjongState): boolean => {
    if (s.status === 'won') return true;
    if (s.status === 'lost') return false;
    const key = `${s.onBoard.join(',')}|${s.slots.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const slotFaces = new Set(s.slots.map(faceOf));
    const free = s.onBoard.filter((id) => isFree(s, id));
    const pairs = free.filter((id) => slotFaces.has(faceOf(id)));
    const rest = free.filter((id) => !slotFaces.has(faceOf(id)));
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

test('every face appears an even number of times, and only known faces are used', () => {
  expect(new Set(FACES).size).toBe(18);
  for (const l of LAYOUTS) {
    for (const seed of [1, 2, 3]) {
      const counts = new Map<string, number>();
      for (const t of makeDeal(l, seed)) counts.set(t.face, (counts.get(t.face) ?? 0) + 1);
      for (const [face, n] of counts) {
        expect(FACES).toContain(face);
        expect(n % 2).toBe(0);
      }
    }
  }
});
