// Removed in Task 6, when the screens ask the server for deals. Until then this is
// only here so they keep working: the deals' tests moved to server/tests/test_mahjong.py
// and shared/deal-samples.json, and server/isoca_play/mahjong.py is the real one.
import { FACES, type Layout } from './layouts';
import { isFree, matchKey, newGame, type Tile } from './rules';

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

const KINDS = [...new Set(FACES.map(matchKey))];

// One match kind per pair. Each block is a fresh shuffle of every kind, so fewer pairs
// than kinds get a random subset, and a kind only repeats after all the others have
// been used, never twice in a row.
function kindSequence(pairs: number, rand: () => number): string[] {
  const out: string[] = [];
  while (out.length < pairs) {
    let block = shuffle(KINDS, rand);
    if (out.length > 0 && block[0] === out[out.length - 1]) block = [...block.slice(1), block[0]];
    out.push(...block);
  }
  return out.slice(0, pairs);
}

// The two faces of a pair: two different ones from a season or flower group, else one face twice.
function pairFaces(kind: string, rand: () => number): [string, string] {
  const group = FACES.filter((face) => matchKey(face) === kind);
  if (group.length === 1) return [group[0], group[0]];
  const [first, second] = shuffle(group, rand);
  return [first, second];
}

// Take away two free tiles at a time and give each pair the next kind. Played in
// that order, the deal is a win that never holds more than one tile in the slots.
function attempt(layout: Layout, rand: () => number): Tile[] | null {
  const tiles: Tile[] = layout.cells.map((c, id) => ({ id, ...c, face: '' }));
  const kinds = kindSequence(tiles.length / 2, rand);
  const state = newGame(tiles);
  let remaining = state.onBoard;
  for (const kind of kinds) {
    const found: number[] = [];
    for (const id of shuffle(remaining, rand)) {
      if (!isFree({ ...state, onBoard: remaining }, id)) continue;
      found.push(id);
      if (found.length === 2) break;
    }
    if (found.length < 2) return null;
    const faces = pairFaces(kind, rand);
    found.forEach((id, i) => {
      tiles[id].face = faces[i];
    });
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
