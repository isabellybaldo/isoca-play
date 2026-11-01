import { expect, test } from 'vitest';
import { FACES, LAYOUTS, layoutsFor, type Level } from './layouts';

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;

test.each(LAYOUTS)('$id fits a phone at 8 tiles wide and 9 rows tall, with an even tile count', (l) => {
  expect(l.cells.length % 2).toBe(0);
  const xs = l.cells.map((c) => c.x);
  const ys = l.cells.map((c) => c.y);
  expect(Math.max(...xs) - Math.min(...xs) + 2).toBeLessThanOrEqual(16); // 8 tiles wide
  expect(Math.max(...ys) - Math.min(...ys) + 2).toBeLessThanOrEqual(18); // 9 rows tall
  expect(new Set(l.cells.map((c) => `${c.x},${c.y},${c.z}`)).size).toBe(l.cells.length);
});

test.each(LAYOUTS)('$id has at most one pair per match kind', (l) => {
  expect(l.cells.length / 2).toBeLessThanOrEqual(36);
});

test.each(LAYOUTS)('$id: tiles on one layer do not overlap', (l) => {
  l.cells.forEach((a, i) => {
    for (const b of l.cells.slice(i + 1)) {
      if (a.z === b.z) expect(overlaps(a, b)).toBe(false);
    }
  });
});

test.each(LAYOUTS)('$id: upper tiles sit half a tile off the layer below and rest on it', (l) => {
  const uppers = l.cells.filter((c) => c.z > 0);
  expect(uppers.length).toBeGreaterThan(0);
  for (const c of uppers) {
    const below = l.cells.filter((o) => o.z === c.z - 1);
    expect(below.some((o) => o.x === c.x && o.y === c.y)).toBe(false);
    expect(below.filter((o) => overlaps(o, c)).length).toBeGreaterThanOrEqual(2);
  }
  expect(uppers.some((c) => c.x % 2 === 1 && c.y % 2 === 1)).toBe(true);
});

test.each(LAYOUTS)('$id is the same from left to right', (l) => {
  const maxX = Math.max(...l.cells.map((c) => c.x));
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const all = new Set(l.cells.map((c) => key(c.x, c.y, c.z)));
  for (const c of l.cells) expect(all.has(key(maxX - c.x, c.y, c.z))).toBe(true);
});

test('each level has one shape, and harder shapes stack higher', () => {
  const top = (id: string) => Math.max(...LAYOUTS.find((l) => l.id === id)!.cells.map((c) => c.z));
  expect(top('frame')).toBeLessThan(top('trophy'));
  expect(top('trophy')).toBeLessThan(top('fort'));
});

test('LAYOUTS has exactly one shape per level', () => {
  expect(LAYOUTS).toHaveLength(3);
  const levels: Level[] = ['easy', 'medium', 'hard'];
  for (const level of levels) expect(layoutsFor(level)).toHaveLength(1);
  expect(layoutsFor('easy')[0].id).toBe('frame');
  expect(layoutsFor('medium')[0].id).toBe('trophy');
  expect(layoutsFor('hard')[0].id).toBe('fort');
});

test('FACES is the approved set, in draw order', () => {
  const nine = (name: string) => Array.from({ length: 9 }, (_, i) => `${name}${i + 1}`);
  expect(FACES).toEqual([
    ...nine('circle'), ...nine('bamboo'), ...nine('star'),
    'cat', 'bunny', 'frog', 'fish',
    'cherry', 'cupcake', 'heart',
    'spring', 'summer', 'autumn', 'winter',
    'plum', 'orchid', 'chrysanthemum', 'rose',
  ]);
});
