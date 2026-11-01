import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { ApiError, loadSave, putSave, type GameName } from './api';
import { LAYOUTS } from './mahjong/layouts';
import type { MahjongState } from './mahjong/rules';
import type { SudokuState } from './sudoku/rules';

// A mahjong save names its layout, and the app looks the shape up. A sudoku state
// already holds its puzzle.
export type MahjongSave = { layout: string; state: MahjongState };
export type Saved = { mahjong: MahjongSave; sudoku: SudokuState };
export type SaveStatus = 'saved' | 'retrying' | 'offline';

const FIRST_WAIT = 1000;
const LONGEST_WAIT = 30_000;
const FLUSH_LIMIT = 3000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// A save this app cannot play counts as no save. It stays on the server until a new
// game replaces it.
const PLAYABLE: Record<GameName, (body: unknown) => boolean> = {
  mahjong: (body) =>
    isRecord(body) &&
    LAYOUTS.some((l) => l.id === body.layout) &&
    isRecord(body.state) &&
    Array.isArray(body.state.tiles) &&
    Array.isArray(body.state.onBoard) &&
    Array.isArray(body.state.slots) &&
    Array.isArray(body.state.history),
  sudoku: (body) =>
    isRecord(body) &&
    isRecord(body.puzzle) &&
    typeof body.puzzle.givens === 'string' &&
    typeof body.puzzle.solution === 'string' &&
    Array.isArray(body.values) &&
    Array.isArray(body.notes) &&
    Array.isArray(body.history),
};

const isOffline = () => navigator.onLine === false;

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => !isOffline());
  useEffect(() => {
    const update = () => setOnline(!isOffline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

// One game, kept with the server. One request at a time, so saves arrive in order: what
// changes meanwhile goes out next, the latest state only. A failed request tries again
// with a growing wait, and at once when the device is back online or the page in focus.
// Until the load has answered, nothing can be set or saved, so a page that has not seen
// the saved game can never replace it.
export function useSavedGame<G extends GameName>(game: G) {
  type State = Saved[G] | null;
  const [state, setShown] = useState<State>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState<SaveStatus>('saved');
  const [signedOut, setSignedOut] = useState(false);

  const link = useRef({
    state: null as State,
    ready: false,
    unsent: false,
    busy: false,
    mounted: false,
    failures: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    waiting: [] as (() => void)[],
  }).current;

  const run = useCallback(async () => {
    clearTimeout(link.timer);
    link.timer = undefined;
    if (link.busy || (link.ready && !link.unsent)) return;
    link.busy = true;
    try {
      if (link.ready) {
        link.unsent = false;
        try {
          await putSave(game, link.state);
        } catch (error) {
          link.unsent = true;
          throw error;
        }
      } else {
        const body = await loadSave(game);
        link.state = PLAYABLE[game](body) ? (body as State) : null;
        link.ready = true;
        setShown(link.state);
        setReady(true);
      }
      link.failures = 0;
      setSaving('saved');
      setSignedOut(false);
    } catch (error) {
      link.busy = false;
      setSaving(isOffline() ? 'offline' : 'retrying');
      setSignedOut(error instanceof ApiError && error.status === 401);
      if (link.mounted) {
        const wait = Math.min(FIRST_WAIT * 2 ** link.failures, LONGEST_WAIT);
        link.failures += 1;
        link.timer = setTimeout(() => void run(), wait);
      }
      return;
    }
    link.busy = false;
    if (link.unsent) {
      void run();
    } else {
      for (const done of link.waiting.splice(0)) done();
    }
  }, [game, link]);

  useEffect(() => {
    link.mounted = true;
    void run();
    const retryNow = () => {
      if (link.timer === undefined) return;
      link.failures = 0;
      void run();
    };
    const wentOffline = () => {
      if (link.timer !== undefined) setSaving('offline');
    };
    window.addEventListener('online', retryNow);
    window.addEventListener('focus', retryNow);
    window.addEventListener('offline', wentOffline);
    return () => {
      link.mounted = false;
      clearTimeout(link.timer);
      link.timer = undefined;
      window.removeEventListener('online', retryNow);
      window.removeEventListener('focus', retryNow);
      window.removeEventListener('offline', wentOffline);
    };
  }, [run, link]);

  const setGame = useCallback(
    (action: SetStateAction<State>) => {
      if (!link.ready) return;
      const next = typeof action === 'function' ? (action as (s: State) => State)(link.state) : action;
      if (next === link.state) return;
      link.state = next;
      setShown(next);
      if (next === null) return;
      link.unsent = true;
      if (link.timer === undefined) void run();
    },
    [link, run],
  );

  // Resolves when nothing is left to send, or at the time limit if that does not come.
  const flush = useCallback(
    (limit = FLUSH_LIMIT) =>
      new Promise<void>((resolve) => {
        if (!link.busy && !link.unsent && link.timer === undefined) return resolve();
        const timer = setTimeout(resolve, limit);
        link.waiting.push(() => {
          clearTimeout(timer);
          resolve();
        });
      }),
    [link],
  );

  return { state, setState: setGame, saving, signedOut, ready, flush };
}
