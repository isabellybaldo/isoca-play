import type { Layout } from './layouts';

const SIDE_PADDING = 16; // each side of the viewport

// The two sizes of the 18 x 23 sprite: 2x and 3x. Never a fractional scale.
const SMALL = 36;
const LARGE = 54;

// Everything above and below the board on the game screen, in px: 12 of padding each
// end, the 44 px bar, the 54 px slots, the 44 px buttons and the three 8 px gaps.
export const GAME_CHROME = 12 + 44 + 8 + 54 + 8 + 8 + 44 + 12;
// Without the slots row, its 54 px and one of the gaps are gone.
const SLOTS_ROW = 54 + 8;

export function tileHeight(width: number): number {
  return (width * 23) / 18;
}

// A row is 40/46 of a tile tall, so a tile's rose edge tucks under the row below.
function rowPitch(width: number): number {
  return (tileHeight(width) * 40) / 46;
}

function extent(layout: Layout) {
  const xs = layout.cells.map((c) => c.x);
  const ys = layout.cells.map((c) => c.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    // x and y are in half-tile units, and a tile is 2 of them across.
    spanX: (Math.max(...xs) - Math.min(...xs)) / 2,
    spanY: (Math.max(...ys) - Math.min(...ys)) / 2,
  };
}

export function boardBox(layout: Layout, width: number): { width: number; height: number } {
  const { spanX, spanY } = extent(layout);
  return {
    width: spanX * width + width,
    height: spanY * rowPitch(width) + tileHeight(width),
  };
}

// 54 px only when the whole board and the rows around it fit the viewport. Otherwise
// 36 px, the smallest size: a board at most 8 tiles wide and 9 rows tall fits 320 x 568.
export function tileWidth(
  layout: Layout,
  viewportWidth: number,
  viewportHeight: number,
  options?: { noSlots?: boolean },
): number {
  const box = boardBox(layout, LARGE);
  const chrome = options?.noSlots ? GAME_CHROME - SLOTS_ROW : GAME_CHROME;
  const fits = box.width <= viewportWidth - SIDE_PADDING * 2 && box.height + chrome <= viewportHeight;
  return fits ? LARGE : SMALL;
}

export function tilePosition(
  cell: { x: number; y: number; z: number },
  layout: Layout,
  width: number,
): { left: number; top: number } {
  const { minX, minY } = extent(layout);
  return {
    left: ((cell.x - minX) / 2) * width,
    top: ((cell.y - minY) / 2) * rowPitch(width),
  };
}
