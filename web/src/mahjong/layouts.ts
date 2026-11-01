export type Level = 'easy' | 'medium' | 'hard';
export type Layout = {
  id: string;
  name: string;
  level: Level;
  cells: { x: number; y: number; z: number }[];
};

// Each layer is a list of rows; '#' is a tile, anything else is empty.
// One character is one tile, so a column is 2 half-tile units and a row is 2 units.
// Every layer is 8 columns by 10 rows at most.
function fromLayers(layers: string[][]): Layout['cells'] {
  const cells: Layout['cells'] = [];
  layers.forEach((rows, z) => {
    rows.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch === '#') cells.push({ x: c * 2, y: r * 2, z });
      });
    });
  });
  return cells;
}

// A picture frame with a small picture in the middle. 36 tiles, 1 layer.
const frame = fromLayers([
  [
    '########',
    '#......#',
    '#......#',
    '#......#',
    '#..##..#',
    '#..##..#',
    '#......#',
    '#......#',
    '#......#',
    '########',
  ],
]);

// A cup on a stem and a base, with two handles. 58 tiles, 3 layers.
const trophy = fromLayers([
  [
    '.######.',
    '#.####.#',
    '#.####.#',
    '.######.',
    '..####..',
    '...##...',
    '...##...',
    '...##...',
    '..####..',
    '.######.',
  ],
  [
    '........',
    '..####..',
    '..####..',
    '...##...',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ],
  [
    '........',
    '...##...',
    '...##...',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ],
]);

// Four corner towers joined by walls around a keep. 72 tiles, 4 layers.
const fort = fromLayers([
  [
    '##....##',
    '##....##',
    '########',
    '#......#',
    '#..##..#',
    '#..##..#',
    '#......#',
    '########',
    '##....##',
    '##....##',
  ],
  [
    '##....##',
    '##....##',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '##....##',
    '##....##',
  ],
  [
    '##....##',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '##....##',
  ],
  [
    '#......#',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '#......#',
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

// Cute pixel subjects, drawn in the tile art. Layouts with more than 18 pairs reuse them.
export const FACES: string[] = [
  'cat', 'sun', 'star', 'moon', 'heart', 'cloud',
  'flower', 'mushroom', 'fish', 'duck', 'bunny', 'frog',
  'cherry', 'cupcake', 'rainbow', 'ghost', 'gem', 'leaf',
];
