import { describe, expect, test } from 'vitest';
import { dropPile, type PileBox } from './drag';

const END = 800;
const boxes: PileBox[] = [
  { pile: 'f0', left: 150, right: 200, top: 0, bottom: 72 },
  { pile: 'f1', left: 200, right: 250, top: 0, bottom: 72 },
  { pile: 'c0', left: 0, right: 50, top: 78, bottom: END },
  { pile: 'c1', left: 50, right: 100, top: 78, bottom: END },
];

describe('dropPile', () => {
  test('picks the column under the point', () => {
    expect(dropPile(boxes, 25, 100)).toBe('c0');
    expect(dropPile(boxes, 75, 100)).toBe('c1');
  });

  test('a drop anywhere below a column lands on it', () => {
    expect(dropPile(boxes, 75, END - 1)).toBe('c1');
  });

  test('picks an answer pile in the top row', () => {
    expect(dropPile(boxes, 175, 36)).toBe('f0');
    expect(dropPile(boxes, 225, 36)).toBe('f1');
  });

  test('a shared edge goes to one pile only', () => {
    expect(dropPile(boxes, 50, 100)).toBe('c1');
  });

  test.each([
    ['in the top row, left of the answer piles', 75, 36],
    ['between the top row and the columns', 25, 75],
    ['right of everything', 500, 100],
    ['left of everything', -1, 100],
    ['above everything', 175, -1],
  ])('null %s', (_name, x, y) => {
    expect(dropPile(boxes, x, y)).toBeNull();
  });
});
