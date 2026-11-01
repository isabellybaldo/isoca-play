import type { Layout } from './layouts';

const SIDE_PADDING = 16; // each side of the viewport
export const LAYER_STEP = 4; // px an upper layer sits up and left of the one below
export const TILE_SHADOW_X = 2; // px the hard shadow reaches past a tile, as in mahjong.css
export const TILE_SHADOW_Y = 3;

function extent(layout: Layout) {
  const xs = layout.cells.map((c) => c.x);
  const ys = layout.cells.map((c) => c.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    // x and y are in half-tile units, and a tile is 2 of them across.
    columns: (Math.max(...xs) - Math.min(...xs) + 2) / 2,
    rows: (Math.max(...ys) - Math.min(...ys) + 2) / 2,
    maxZ: Math.max(...layout.cells.map((c) => c.z)),
  };
}

// The largest whole pixel width that fits the viewport with 16 px of side padding.
export function tileWidth(layout: Layout, viewportWidth: number): number {
  const { columns, maxZ } = extent(layout);
  const room = viewportWidth - SIDE_PADDING * 2 - maxZ * LAYER_STEP - TILE_SHADOW_X;
  return Math.max(1, Math.floor(room / columns));
}

// Tiles are square, so the same width sets the height.
export function boardBox(layout: Layout, width: number): { width: number; height: number } {
  const { columns, rows, maxZ } = extent(layout);
  return {
    width: columns * width + maxZ * LAYER_STEP + TILE_SHADOW_X,
    height: rows * width + maxZ * LAYER_STEP + TILE_SHADOW_Y,
  };
}

export function tilePosition(
  cell: { x: number; y: number; z: number },
  layout: Layout,
  width: number,
): { left: number; top: number } {
  const { minX, minY, maxZ } = extent(layout);
  const lift = (maxZ - cell.z) * LAYER_STEP;
  return {
    left: ((cell.x - minX) / 2) * width + lift,
    top: ((cell.y - minY) / 2) * width + lift,
  };
}
