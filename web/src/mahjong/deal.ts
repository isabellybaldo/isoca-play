import { FACES, type Layout } from './layouts';
import { isFree, newGame, type Tile } from './rules';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// One face per pair. Each block is a fresh shuffle of every face, so a face only
// repeats after all the others have been used, and never twice in a row.
function faceSequence(pairs: number, rand: () => number): string[] {
  const out: string[] = [];
  while (out.length < pairs) {
    let block = shuffle(FACES, rand);
    if (out.length > 0 && block[0] === out[out.length - 1]) block = [...block.slice(1), block[0]];
    out.push(...block);
  }
  return out.slice(0, pairs);
}

// Take away two free tiles at a time and give each pair the next face. Played in
// that order, the deal is a win that never holds more than one tile in the slots.
function attempt(layout: Layout, rand: () => number): Tile[] | null {
  const tiles: Tile[] = layout.cells.map((c, id) => ({ id, ...c, face: '' }));
  const faces = faceSequence(tiles.length / 2, rand);
  const state = newGame(tiles);
  let remaining = state.onBoard;
  for (let pair = 0; pair < faces.length; pair++) {
    const found: number[] = [];
    for (const id of shuffle(remaining, rand)) {
      if (!isFree({ ...state, onBoard: remaining }, id)) continue;
      found.push(id);
      if (found.length === 2) break;
    }
    if (found.length < 2) return null;
    for (const id of found) tiles[id].face = faces[pair];
    remaining = remaining.filter((id) => !found.includes(id));
  }
  return tiles;
}

export function makeDeal(layout: Layout, seed: number): Tile[] {
  const rand = mulberry32(seed);
  for (;;) {
    const tiles = attempt(layout, rand);
    if (tiles) return tiles;
  }
}
