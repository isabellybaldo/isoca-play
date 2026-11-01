import { expect, test } from 'vitest';
import { LAYOUTS, layoutsFor, type Level } from './layouts';

test.each(LAYOUTS)('$id fits a portrait phone and has an even tile count', (l) => {
  expect(l.cells.length % 2).toBe(0);
  const xs = l.cells.map((c) => c.x);
  const ys = l.cells.map((c) => c.y);
  expect(Math.max(...xs) - Math.min(...xs) + 2).toBeLessThanOrEqual(16); // 8 tiles wide
  expect(Math.max(...ys) - Math.min(...ys) + 2).toBeLessThanOrEqual(20); // 10 tiles tall
  expect(new Set(l.cells.map((c) => `${c.x},${c.y},${c.z}`)).size).toBe(l.cells.length);
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
