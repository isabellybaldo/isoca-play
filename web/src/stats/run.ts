import type { GameName } from '../api';
import { LAYOUTS } from '../mahjong/layouts';
import type { Saved } from '../useSavedGame';

// The counters of the game under way. They ride in its save, so they move between devices
// with it and survive a reload, and reach the server only along with a real move.
export type Run = {
  id: string;
  seconds: number;
  returns: number;
  tips: number;
  days: string[];
  unsolved: number;
  turns: number;
  done: boolean;
};

export type GameRecord = {
  id: string;
  game: GameName;
  level: string | null;
  result: 'won' | 'lost' | 'abandoned';
  day: string;
  days: string[];
  seconds: number;
  returns: number;
  tips: number;
  map: string | null;
  slots: boolean | null;
  moves: number | null;
  unsolved: number | null;
  turns: number | null;
};

// What has built up on the device since the last move, and how to name a new game.
export type Tick = { today: string; seconds: number; tips: number; newId: () => string };

const MAX_SECONDS = 30 * 24 * 60 * 60; // the server's limits
const MAX_DAYS = 400;

const isCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// A save from before this shipped has none, and one from elsewhere may have anything.
export function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    [r.seconds, r.returns, r.tips, r.unsolved, r.turns].every(isCount) &&
    Array.isArray(r.days) &&
    r.days.every((d) => typeof d === 'string') &&
    typeof r.done === 'boolean'
  );
}

// Where each game keeps what this needs. A mahjong save holds its state one level down.
type View = { deal: unknown; history: unknown[]; status: string };
const VIEW: { [G in GameName]: (save: Saved[G]) => View } = {
  mahjong: (s) => ({ deal: s.state.tiles, history: s.state.history, status: s.state.status }),
  solitaire: (s) => ({ deal: s.deal, history: s.history, status: s.status }),
  sudoku: (s) => ({ deal: s.puzzle, history: s.history, status: s.status }),
};

function details<G extends GameName>(game: G, save: Saved[G], run: Run): Pick<GameRecord, 'level' | 'map' | 'slots' | 'moves' | 'unsolved' | 'turns'> {
  const none = { level: null, map: null, slots: null, moves: null, unsolved: null, turns: null };
  if (game === 'mahjong') {
    const s = save as Saved['mahjong'];
    const level = LAYOUTS.find((l) => l.id === s.layout)?.level ?? null;
    return { ...none, level, map: s.layout, slots: !s.state.noSlots, moves: s.state.history.length };
  }
  if (game === 'sudoku') return { ...none, level: (save as Saved['sudoku']).puzzle.level, unsolved: run.unsolved };
  return { ...none, turns: run.turns };
}

function recordOf<G extends GameName>(game: G, save: Saved[G], run: Run, result: GameRecord['result'], today: string): GameRecord {
  return {
    id: run.id,
    game,
    result,
    day: today,
    days: run.days.slice(-MAX_DAYS),
    seconds: Math.min(Math.round(run.seconds), MAX_SECONDS),
    returns: run.returns,
    tips: run.tips,
    ...details(game, save, run),
  };
}

const freshRun = (id: string): Run => ({ id, seconds: 0, returns: 0, tips: 0, days: [], unsolved: 0, turns: 0, done: false });

const spend = (run: Run, tick: Tick): Run => ({ ...run, seconds: run.seconds + tick.seconds, tips: run.tips + tick.tips });

// A save change, seen from outside the rules: what it means for the counters, and any game
// it finished. A change that is no move hands back the same object, so it stays no save.
export function track<G extends GameName>(
  game: G,
  prev: Saved[G] | null,
  next: Saved[G] | null,
  tick: Tick,
): { save: Saved[G] | null; records: GameRecord[]; spent: boolean } {
  const view = VIEW[game] as (save: Saved[G]) => View;
  const was = prev && view(prev);
  const now = next && view(next);

  if (!now || !was || was.deal !== now.deal) {
    const records: GameRecord[] = [];
    const old = prev?.run;
    if (prev && was && isRun(old) && !old.done && old.days.length > 0) {
      records.push(recordOf(game, prev, spend(old, tick), was.status === 'lost' ? 'lost' : 'abandoned', tick.today));
    }
    if (!next) return { save: null, records, spent: true };
    return { save: { ...next, run: freshRun(tick.newId()) }, records, spent: true };
  }

  const run = prev.run;
  if (!isRun(run) || run.done) return { save: next, records: [], spent: false };

  const longer = now.history.length > was.history.length;
  const shorter = now.history.length < was.history.length;
  if (!longer && !shorter) return { save: next, records: [], spent: false };

  const counted = spend(run, tick);
  if (shorter) counted.returns += 1;
  if (longer && !counted.days.includes(tick.today)) counted.days = [...counted.days, tick.today];
  if (longer && now.history.at(-1) === 'r') counted.turns += 1;
  if (now.status === 'unsolved' && was.status !== 'unsolved') counted.unsolved += 1;
  if (now.status !== 'won') return { save: { ...next, run: counted }, records: [], spent: true };

  counted.done = true;
  const save = { ...next, run: counted };
  return { save, records: [recordOf(game, save, counted, 'won', tick.today)], spent: true };
}
