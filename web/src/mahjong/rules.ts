export type Tile = { id: number; x: number; y: number; z: number; face: string };

// x and y are in half-tile units: a tile is 2 wide and 2 tall.
export type MahjongState = {
  tiles: Tile[]; // every tile, never mutated
  onBoard: number[]; // ids still on the board
  slots: number[]; // ids in slot order, at most 4
  selected: number | null;
  history: { onBoard: number[]; slots: number[] }[];
  status: 'playing' | 'won' | 'lost';
};

export const SLOT_COUNT = 4;

export function newGame(tiles: Tile[]): MahjongState {
  return {
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
  const pairAt = s.slots.findIndex((slotId) => tileById(s, slotId)?.face === tile.face);
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

export function tap(s: MahjongState, id: number): MahjongState {
  if (s.status !== 'playing') return s;
  if (!s.onBoard.includes(id) || !isFree(s, id)) return s;
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
