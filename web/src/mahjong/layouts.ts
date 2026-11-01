import shared from '../../../shared/layouts.json';
import faces from '../../../shared/faces.json';

export type Level = 'easy' | 'medium' | 'hard';
export type Layout = {
  id: string;
  name: string;
  level: Level;
  cells: { x: number; y: number; z: number }[];
};

// Each layer is a list of rows; '#' is a tile, anything else is empty.
// One character is one tile, so a column is 2 half-tile units and a row is 2 units.
// Odd layers sit half a tile right of and below the even layers, so an upper tile lies
// across the tiles under it and their rose backs show. That makes an odd layer one
// character narrower and one row shorter. Every shape is 8 columns by 9 rows at most.
function fromLayers(layers: string[][]): Layout['cells'] {
  const cells: Layout['cells'] = [];
  layers.forEach((rows, z) => {
    const half = z % 2;
    rows.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch === '#') cells.push({ x: c * 2 + half, y: r * 2 + half, z });
      });
    });
  });
  return cells;
}

// The shapes themselves are in shared/layouts.json, which the server reads too.
export const LAYOUTS: Layout[] = shared.map((l) => ({
  id: l.id,
  name: l.name,
  level: l.level as Level,
  cells: fromLayers(l.layers),
}));

export function layoutsFor(level: Level): Layout[] {
  return LAYOUTS.filter((l) => l.level === level);
}

// The 42 faces of the set, in draw order. Their art is in TileArt.tsx.
export const FACES: string[] = faces.faces;
