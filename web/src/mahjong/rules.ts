import faces from '../../../shared/faces.json';

export type Tile = { id: number; x: number; y: number; z: number; face: string };

// x and y are in half-tile units: a tile is 2 wide and 2 tall.
export type MahjongState = {
  tiles: Tile[]; // every tile, never mutated
  onBoard: number[]; // ids still on the board
  slots: number[]; // ids in slot order, at most 4
  selected: number | null;
  history: { onBoard: number[]; slots: number[] }[];
  status: 'playing' | 'won' | 'lost';
  noSlots?: boolean; // a pair of free matching tiles leaves directly; absent in slots games
};

export const SLOT_COUNT = 4;

const SEASONS = faces.groups.season;
const FLOWERS = faces.groups.flower;

// Two tiles pair when their keys are equal: any season matches any season, any
// flower matches any flower, and everything else matches only itself.
export function matchKey(face: string): string {
  if (SEASONS.includes(face)) return 'season';
  if (FLOWERS.includes(face)) return 'flower';
  return face;
}

export function newGame(tiles: Tile[], options?: { noSlots?: boolean }): MahjongState {
  return {
    ...(options?.noSlots ? { noSlots: true } : {}),
    tiles,
    onBoard: tiles.map((tile) => tile.id),
    slots: [],
    selected: null,
    history: [],
    status: 'playing',
  };
}

function tileById(s: MahjongState, id: number): Tile | undefined {
  return s.tiles.find((tile) => tile.id === id);
}

function boardTiles(s: MahjongState, except: Tile): Tile[] {
  const out: Tile[] = [];
  for (const id of s.onBoard) {
    if (id === except.id) continue;
    const other = tileById(s, id);
    if (other) out.push(other);
  }
  return out;
}

// Covered: a board tile one layer up overlaps this one by less than a full tile in both axes.
export function isCovered(s: MahjongState, id: number): boolean {
  const tile = tileById(s, id);
  if (!tile) return false;
  return boardTiles(s, tile).some(
    (o) => o.z === tile.z + 1 && Math.abs(o.x - tile.x) < 2 && Math.abs(o.y - tile.y) < 2,
  );
}

// Free: not covered, and the left or the right side has no neighbour on the same layer.
export function isFree(s: MahjongState, id: number): boolean {
  const tile = tileById(s, id);
  if (!tile || isCovered(s, id)) return false;
  const others = boardTiles(s, tile).filter((o) => o.z === tile.z && Math.abs(o.y - tile.y) < 2);
  const leftBlocked = others.some((o) => o.x - tile.x === -2);
  const rightBlocked = others.some((o) => o.x - tile.x === 2);
  return !leftBlocked || !rightBlocked;
}

function send(s: MahjongState, id: number): MahjongState {
  const tile = tileById(s, id)!;
  const onBoard = s.onBoard.filter((b) => b !== id);
  const key = matchKey(tile.face);
  const pairAt = s.slots.findIndex((slotId) => {
    const held = tileById(s, slotId);
    return held !== undefined && matchKey(held.face) === key;
  });
  const slots = pairAt >= 0 ? s.slots.filter((_, i) => i !== pairAt) : [...s.slots, id];
  let status: MahjongState['status'] = 'playing';
  if (slots.length >= SLOT_COUNT) status = 'lost';
  else if (onBoard.length === 0 && slots.length === 0) status = 'won';
  return {
    ...s,
    onBoard,
    slots,
    selected: null,
    history: [...s.history, { onBoard: [...s.onBoard], slots: [...s.slots] }],
    status,
  };
}

// Free tiles that match, as pairs of ids in onBoard order.
export function freePairs(s: MahjongState): [number, number][] {
  const free = s.onBoard.filter((id) => isFree(s, id));
  const keys = free.map((id) => matchKey(tileById(s, id)!.face));
  const out: [number, number][] = [];
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      if (keys[i] === keys[j]) out.push([free[i], free[j]]);
    }
  }
  return out;
}

// No slots: the pair leaves the board at once. The board is lost when tiles remain and no pair is free.
function removePair(s: MahjongState, a: number, b: number): MahjongState {
  const next: MahjongState = {
    ...s,
    onBoard: s.onBoard.filter((id) => id !== a && id !== b),
    selected: null,
    history: [...s.history, { onBoard: [...s.onBoard], slots: [...s.slots] }],
  };
  if (next.onBoard.length === 0) return { ...next, status: 'won' };
  return { ...next, status: freePairs(next).length === 0 ? 'lost' : 'playing' };
}

function tapNoSlots(s: MahjongState, id: number): MahjongState {
  if (s.selected === id) return { ...s, selected: null };
  if (s.selected === null) return { ...s, selected: id };
  const held = tileById(s, s.selected);
  const tile = tileById(s, id);
  if (held && tile && matchKey(held.face) === matchKey(tile.face)) return removePair(s, s.selected, id);
  return { ...s, selected: id };
}

export function tap(s: MahjongState, id: number): MahjongState {
  if (s.status !== 'playing') return s;
  if (!s.onBoard.includes(id) || !isFree(s, id)) return s;
  if (s.noSlots) return tapNoSlots(s, id);
  if (s.selected === id) return send(s, id);
  return { ...s, selected: id };
}

// A new deal would throw away work: there are moves, and the board is not cleared.
export function hasMovesToLose(s: MahjongState): boolean {
  return s.history.length > 0 && s.status !== 'won';
}

export function tapElsewhere(s: MahjongState): MahjongState {
  if (s.status !== 'playing' || s.selected === null) return s;
  return { ...s, selected: null };
}

export function undo(s: MahjongState): MahjongState {
  const last = s.history[s.history.length - 1];
  if (!last) return s;
  return {
    ...s,
    onBoard: [...last.onBoard],
    slots: [...last.slots],
    selected: null,
    history: s.history.slice(0, -1),
    status: 'playing',
  };
}
