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

// A picture frame with a small picture hung in the middle and its corners doubled.
// 42 tiles, 2 layers.
const frame = fromLayers([
  [
    '########',
    '#......#',
    '#......#',
    '#..##..#',
    '#..##..#',
    '#..##..#',
    '#......#',
    '#......#',
    '########',
  ],
  [
    '#.....#',
    '.......',
    '.......',
    '...#...',
    '...#...',
    '.......',
    '.......',
    '#.....#',
  ],
]);

// A cup on a stem and a base, with two handles. 62 tiles, 3 layers.
const trophy = fromLayers([
  [
    '.######.',
    '#.####.#',
    '#.####.#',
    '.######.',
    '..####..',
    '...##...',
    '...##...',
    '..####..',
    '.######.',
  ],
  [
    '.#####.',
    '..###..',
    '.#####.',
    '.......',
    '.......',
    '.......',
    '.......',
    '..###..',
  ],
  [
    '........',
    '...##...',
    '...##...',
  ],
]);

// Four corner towers joined by walls around a keep. 72 tiles, 4 layers.
const fort = fromLayers([
  [
    '.##..##.',
    '###..###',
    '########',
    '#......#',
    '#..##..#',
    '#......#',
    '########',
    '###..###',
    '.##..##.',
  ],
  [
    '##...##',
    '##...##',
    '.......',
    '.......',
    '.......',
    '.......',
    '##...##',
    '##...##',
  ],
  [
    '........',
    '.##..##.',
    '........',
    '........',
    '........',
    '........',
    '........',
    '.##..##.',
  ],
  [
    '.......',
    '.#...#.',
    '.......',
    '.......',
    '.......',
    '.......',
    '.#...#.',
  ],
]);

export const LAYOUTS: Layout[] = [
  { id: 'frame', name: 'Frame', level: 'easy', cells: frame },
  { id: 'trophy', name: 'Trophy', level: 'medium', cells: trophy },
  { id: 'fort', name: 'Fort', level: 'hard', cells: fort },
];

export function layoutsFor(level: Level): Layout[] {
  return LAYOUTS.filter((l) => l.level === level);
}

function suit(name: string): string[] {
  return Array.from({ length: 9 }, (_, i) => `${name}${i + 1}`);
}

// The 42 faces of the set, in draw order. Their art is in TileArt.tsx.
export const FACES: string[] = [
  ...suit('circle'),
  ...suit('bamboo'),
  ...suit('star'),
  'cat', 'bunny', 'frog', 'fish',
  'cherry', 'cupcake', 'heart',
  'spring', 'summer', 'autumn', 'winter',
  'plum', 'orchid', 'chrysanthemum', 'rose',
];
