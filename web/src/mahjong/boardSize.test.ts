import { describe, expect, test } from 'vitest';
import { boardBox, GAME_CHROME, tileHeight, tilePosition, tileWidth } from './boardSize';
import { LAYOUTS, type Layout } from './layouts';

const SIDE_PADDING = 16;

const shape = (cells: Layout['cells']): Layout => ({ id: 't', name: 'T', level: 'easy', cells });
const wide = (columns: number) =>
  shape(Array.from({ length: columns }, (_, i) => ({ x: i * 2, y: 0, z: 0 })));
const tall = (rows: number) =>
  shape(Array.from({ length: rows }, (_, i) => ({ x: 0, y: i * 2, z: 0 })));

test('the two sizes are the 18 x 23 sprite at 2x and 3x', () => {
  expect(tileHeight(36)).toBe(46);
  expect(tileHeight(54)).toBe(69);
});

describe.each(LAYOUTS)('$id on the board', (l: Layout) => {
  test.each([
    [320, 568],
    [360, 640],
    [390, 844],
    [440, 900],
    [1366, 768],
  ])('at %i x %i the whole board fits, across and down', (vw, vh) => {
    const width = tileWidth(l, vw, vh);
    expect([36, 54]).toContain(width);
    const box = boardBox(l, width);
    expect(box.width).toBeLessThanOrEqual(vw - SIDE_PADDING * 2);
    expect(box.height + GAME_CHROME).toBeLessThanOrEqual(vh);
  });

  test('is 36 px at 320 x 568 and on a 390 px phone, and 54 px on a laptop', () => {
    expect(tileWidth(l, 320, 568)).toBe(36);
    expect(tileWidth(l, 390, 844)).toBe(36);
    expect(tileWidth(l, 1366, 768)).toBe(54);
  });

  test.each([36, 54])('every tile stays inside the board box at %i px', (width) => {
    const box = boardBox(l, width);
    for (const cell of l.cells) {
      const { left, top } = tilePosition(cell, l, width);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(box.width);
      expect(top + tileHeight(width)).toBeLessThanOrEqual(box.height);
      expect(Number.isInteger(left) && Number.isInteger(top)).toBe(true);
    }
  });
});

describe('choosing the size', () => {
  test('54 needs the width of the whole board', () => {
    expect(tileWidth(wide(8), 463, 2000)).toBe(36); // 432 + 32 = 464
    expect(tileWidth(wide(8), 464, 2000)).toBe(54);
    expect(tileWidth(wide(6), 390, 2000)).toBe(54);
  });

  test('54 needs the height of the whole board and the rows around it', () => {
    const need = boardBox(tall(9), 54).height + GAME_CHROME;
    expect(tileWidth(tall(9), 1366, need)).toBe(54);
    expect(tileWidth(tall(9), 1366, need - 1)).toBe(36);
  });

  test('36 is the floor, even when nothing fits', () => {
    expect(tileWidth(wide(8), 200, 200)).toBe(36);
  });
});

describe('placement', () => {
  const l = shape([{ x: 2, y: 4, z: 0 }, { x: 3, y: 5, z: 1 }, { x: 4, y: 6, z: 0 }]);

  test('a column is one tile wide, and a row is 40/46 of a tile tall', () => {
    expect(tilePosition({ x: 4, y: 6, z: 0 }, l, 36)).toEqual({ left: 36, top: 40 });
    expect(tilePosition({ x: 4, y: 6, z: 0 }, l, 54)).toEqual({ left: 54, top: 60 });
  });

  test('half a unit is half a pitch, and the layer adds no step', () => {
    expect(tilePosition({ x: 3, y: 5, z: 1 }, l, 36)).toEqual({ left: 18, top: 20 });
    expect(tilePosition({ x: 3, y: 5, z: 9 }, l, 54)).toEqual({ left: 27, top: 30 });
  });

  test('the box is the pitches plus one whole tile', () => {
    expect(boardBox(l, 36)).toEqual({ width: 36 * 2, height: 40 + 46 });
    expect(boardBox(l, 54)).toEqual({ width: 54 * 2, height: 60 + 69 });
  });

  test('nine rows of 36 px tiles are 366 px tall', () => {
    expect(boardBox(tall(9), 36).height).toBe(366);
  });
});
