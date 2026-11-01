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

test.each(LAYOUTS.filter((l) => ['frame', 'trophy', 'fort'].includes(l.id)))('$id is the same from left to right', (l) => {
  const maxX = Math.max(...l.cells.map((c) => c.x));
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const all = new Set(l.cells.map((c) => key(c.x, c.y, c.z)));
  for (const c of l.cells) expect(all.has(key(maxX - c.x, c.y, c.z))).toBe(true);
});

test('harder shapes stack higher', () => {
  const top = (level: Level) =>
    Math.max(...layoutsFor(level).flatMap((l) => l.cells.map((c) => c.z)));
  expect(top('easy')).toBe(1);
  expect(top('medium')).toBe(2);
  expect(top('hard')).toBe(3);
});

test('LAYOUTS has four shapes per level, the existing one first', () => {
  expect(LAYOUTS).toHaveLength(12);
  const ids: Record<Level, string[]> = {
    easy: ['frame', 'heart', 'cat', 'cherry'],
    medium: ['trophy', 'butterfly', 'panda', 'moon'],
    hard: ['fort', 'rose', 'frog', 'gate'],
  };
  for (const level of Object.keys(ids) as Level[]) {
    expect(layoutsFor(level).map((l) => l.id)).toEqual(ids[level]);
  }
});

test.each(LAYOUTS)('$id has as many layers as its level', (l) => {
  const layers = { easy: 2, medium: 3, hard: 4 }[l.level];
  expect(Math.max(...l.cells.map((c) => c.z)) + 1).toBe(layers);
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
