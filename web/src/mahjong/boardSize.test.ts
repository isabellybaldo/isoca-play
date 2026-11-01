import { describe, expect, test } from 'vitest';
import { boardBox, tilePosition, tileWidth } from './boardSize';
import { LAYOUTS, type Layout } from './layouts';

const SIDE_PADDING = 16;

test.each(LAYOUTS)('$id tiles are at least 34 px wide at 320 px', (l: Layout) => {
  expect(tileWidth(l, 320)).toBeGreaterThanOrEqual(34);
});

describe.each(LAYOUTS)('$id on the board', (l: Layout) => {
  test.each([320, 360, 390, 440])('fits a %i px viewport with 16 px each side', (viewport: number) => {
    const width = tileWidth(l, viewport);
    expect(boardBox(l, width).width).toBeLessThanOrEqual(viewport - SIDE_PADDING * 2);
  });

  test.each([320, 360, 390, 440])('uses the largest whole width at %i px', (viewport: number) => {
    const width = tileWidth(l, viewport);
    expect(Number.isInteger(width)).toBe(true);
    expect(boardBox(l, width + 1).width).toBeGreaterThan(viewport - SIDE_PADDING * 2);
  });

  test('every tile stays inside the board box', () => {
    const width = 34;
    const box = boardBox(l, width);
    for (const cell of l.cells) {
      const { left, top } = tilePosition(cell, l, width);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(box.width);
      expect(top + width).toBeLessThanOrEqual(box.height);
    }
  });
});

test('a tile one layer up sits up and left of the one below', () => {
  const l: Layout = {
    id: 'two',
    name: 'Two',
    level: 'easy',
    cells: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
  };
  const below = tilePosition(l.cells[0], l, 40);
  const above = tilePosition(l.cells[1], l, 40);
  expect(above.left).toBeLessThan(below.left);
  expect(above.top).toBeLessThan(below.top);
});
