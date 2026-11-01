import { useCallback, useEffect, useState, type SetStateAction } from 'react';
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
const CHECKING_NOTE_AFTER = 1000;
const CHANNEL = 'isoca-play-saves';
// The server will answer these the same way however often it is asked.
const PERMANENT = new Set([400, 403, 413]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isNumbers = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((n) => typeof n === 'number');
const isCell = (value: unknown) => value === null || typeof value === 'number';

function isTile(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.z === 'number' &&
    typeof value.face === 'string'
  );
}

function isPlayableMahjong(body: unknown): boolean {
  if (!isRecord(body) || !LAYOUTS.some((l) => l.id === body.layout)) return false;
  const state = body.state;
  if (!isRecord(state) || !Array.isArray(state.tiles) || !state.tiles.every(isTile)) return false;
  if (!isNumbers(state.onBoard) || !isNumbers(state.slots) || !Array.isArray(state.history)) return false;
  const ids = new Set((state.tiles as { id: number }[]).map((t) => t.id));
  return (
    [...state.onBoard, ...state.slots].every((id) => ids.has(id)) &&
    isCell(state.selected) &&
    ['playing', 'won', 'lost'].includes(state.status as string)
  );
}

function isPlayableSudoku(body: unknown): boolean {
  if (!isRecord(body) || !isRecord(body.puzzle)) return false;
  const { level, givens, solution } = body.puzzle;
  return (
    ['easy', 'medium', 'hard'].includes(level as string) &&
    typeof givens === 'string' &&
    givens.length === 81 &&
    typeof solution === 'string' &&
    solution.length === 81 &&
    isNumbers(body.values) &&
    body.values.length === 81 &&
    isNumbers(body.notes) &&
    body.notes.length === 81 &&
    Array.isArray(body.history) &&
    isCell(body.selected) &&
    ['write', 'notes'].includes(body.mode as string) &&
    ['playing', 'won', 'unsolved'].includes(body.status as string)
  );
}

const PLAYABLE: Record<GameName, (body: unknown) => boolean> = {
  mahjong: isPlayableMahjong,
  sudoku: isPlayableSudoku,
};

// Whether the game itself changed, by the identity the rules keep. A selection or a
// write/notes switch is not a move: it stays in memory and is not worth a request.
const MOVED: { [G in GameName]: (a: Saved[G], b: Saved[G]) => boolean } = {
  mahjong: (a, b) =>
    a.layout !== b.layout ||
    a.state.tiles !== b.state.tiles ||
    a.state.onBoard !== b.state.onBoard ||
    a.state.slots !== b.state.slots ||
    a.state.history !== b.state.history,
  sudoku: (a, b) =>
    a.puzzle !== b.puzzle || a.values !== b.values || a.notes !== b.notes || a.history !== b.history,
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

type Screen<G extends GameName> = {
  show: (state: Saved[G] | null) => void;
  ready: () => void;
  saving: (status: SaveStatus) => void;
  signedOut: (yes: boolean) => void;
  refused: (yes: boolean) => void;
  unplayable: (yes: boolean) => void;
  checking: (yes: boolean) => void;
};

// One game, kept with the server. One request at a time, so saves arrive in order: what
// changes meanwhile goes out next, the latest state only. A failed request tries again
// with a growing wait, and at once when the page wakes. A refusal that cannot change
// stops until the next move.
//
// Until the load has answered, nothing can be set or saved, so a page that has not seen
// the saved game can never replace it. A page that wakes with nothing unsent asks again
// and takes what it finds; moves made while it asks wait, and are dropped if the server
// had newer ones. A page with unsent moves stores them, even over newer ones: last save
// wins.
//
// Tabs tell each other two things. "loaded": a tab has just opened, perhaps after a log
// in, so one waiting with unsent moves tries now. "saved": there is something new to
// fetch. In that order, a tab opened to log in ends up with the moves of the tab that
// sent it there.
function createLink<G extends GameName>(game: G, screen: Screen<G>) {
  type State = Saved[G] | null;
  type Action = SetStateAction<State>;
  const playable = PLAYABLE[game];
  const moved = MOVED[game] as (a: Saved[G], b: Saved[G]) => boolean;

  let state: State = null;
  let savedText = ''; // what the server holds, as far as this tab knows
  let ready = false;
  let unsent = false;
  let busy = false;
  let refused = false;
  let refreshing = false;
  let again = false;
  let mounted = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let channel: BroadcastChannel | undefined;
  let held: Action[] = [];
  const waiting: ((sent: boolean) => void)[] = [];

  const settle = (sent: boolean) => {
    for (const done of waiting.splice(0)) done(sent);
  };
  const post = (type: 'loaded' | 'saved') => channel?.postMessage({ game, type });
  const stopTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const finish = () => {
    if (unsent) {
      void run();
    } else {
      settle(true);
      if (again) void refresh();
    }
  };

  const failed = (error: unknown) => {
    busy = false;
    const status = error instanceof ApiError ? error.status : 0;
    if (PERMANENT.has(status)) {
      refused = true;
      screen.refused(true);
      screen.saving('saved');
      settle(false);
      return;
    }
    screen.saving(isOffline() ? 'offline' : 'retrying');
    screen.signedOut(status === 401);
    if (mounted) {
      const wait = Math.min(FIRST_WAIT * 2 ** failures, LONGEST_WAIT);
      failures += 1;
      timer = setTimeout(() => void run(), wait);
    }
  };

  async function run() {
    stopTimer();
    if (busy || (ready && !unsent)) return;
    busy = true;
    let posting: 'loaded' | 'saved';
    try {
      if (ready) {
        unsent = false;
        const text = JSON.stringify(state);
        try {
          await putSave(game, state);
        } catch (error) {
          unsent = true;
          throw error;
        }
        savedText = text;
        posting = 'saved';
      } else {
        const body = await loadSave(game);
        savedText = JSON.stringify(body);
        const good = playable(body);
        state = good ? (body as State) : null;
        ready = true;
        screen.show(state);
        screen.unplayable(body !== null && !good);
        screen.ready();
        posting = 'loaded';
      }
    } catch (error) {
      failed(error);
      return;
    }
    busy = false;
    failures = 0;
    refused = false;
    screen.refused(false);
    screen.saving('saved');
    screen.signedOut(false);
    post(posting);
    finish();
  }

  async function refresh() {
    if (!ready || busy) {
      again = true;
      return;
    }
    again = false;
    if (unsent || timer !== undefined) return;
    busy = true;
    refreshing = true;
    const note = setTimeout(() => screen.checking(true), CHECKING_NOTE_AFTER);
    let adopted = false;
    try {
      const body = await loadSave(game);
      const text = JSON.stringify(body);
      if (body !== null && text !== savedText) {
        savedText = text;
        if (playable(body)) {
          state = body as State;
          adopted = true;
          screen.show(state);
          screen.unplayable(false);
        } else if (state === null) {
          screen.unplayable(true);
        }
      }
      screen.signedOut(false);
    } catch (error) {
      // No answer: this tab carries on with what it has, and the next wake asks again.
      if (error instanceof ApiError && error.status === 401) screen.signedOut(true);
    }
    clearTimeout(note);
    screen.checking(false);
    busy = false;
    refreshing = false;
    const moves = held;
    held = [];
    if (!adopted) for (const action of moves) apply(action);
    finish();
  }

  const wake = () => {
    if (refused && unsent) return;
    if (timer !== undefined || unsent) {
      failures = 0;
      void run();
    } else {
      void refresh();
    }
  };

  function apply(action: Action) {
    const next = typeof action === 'function' ? (action as (s: State) => State)(state) : action;
    if (next === state) return;
    const before = state;
    state = next;
    screen.show(next);
    if (next === null || (before !== null && !moved(before, next))) return;
    unsent = true;
    screen.unplayable(false);
    if (timer === undefined) void run();
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') wake();
  };
  const onOffline = () => {
    if (timer !== undefined) screen.saving('offline');
  };
  const onMessage = (event: MessageEvent) => {
    if (event.data?.game !== game) return;
    if (event.data.type === 'loaded') wake();
    else if (event.data.type === 'saved' && !unsent) void refresh();
  };

  return {
    start() {
      mounted = true;
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(CHANNEL);
        channel.onmessage = onMessage;
      }
      window.addEventListener('online', wake);
      window.addEventListener('focus', wake);
      window.addEventListener('offline', onOffline);
      document.addEventListener('visibilitychange', onVisible);
      void run();
    },
    stop() {
      mounted = false;
      stopTimer();
      channel?.close();
      channel = undefined;
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    },
    set(action: Action) {
      if (!ready) return;
      if (refreshing) held.push(action);
      else apply(action);
    },
    // Resolves true when nothing is left to send, false if that does not come in time.
    flush(limit: number) {
      return new Promise<boolean>((resolve) => {
        if (refused && unsent) return resolve(false);
        if (!busy && !unsent && timer === undefined) return resolve(true);
        const limitTimer = setTimeout(() => resolve(false), limit);
        waiting.push((sent) => {
          clearTimeout(limitTimer);
          resolve(sent);
        });
      });
    },
    // The game in memory will not draw. Its save stays on the server until a new game
    // replaces it, and until then this is a save that could not be opened.
    giveUp() {
      state = null;
      unsent = false;
      stopTimer();
      screen.show(null);
      screen.unplayable(true);
      settle(true);
    },
  };
}

export function useSavedGame<G extends GameName>(game: G) {
  const [state, setShown] = useState<Saved[G] | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState<SaveStatus>('saved');
  const [signedOut, setSignedOut] = useState(false);
  const [refused, setRefused] = useState(false);
  const [unplayable, setUnplayable] = useState(false);
  const [checking, setChecking] = useState(false);

  const [link] = useState(() =>
    createLink(game, {
      show: setShown,
      ready: () => setReady(true),
      saving: setSaving,
      signedOut: setSignedOut,
      refused: setRefused,
      unplayable: setUnplayable,
      checking: setChecking,
    }),
  );

  useEffect(() => {
    link.start();
    return link.stop;
  }, [link]);

  const setState = useCallback((action: SetStateAction<Saved[G] | null>) => link.set(action), [link]);
  const flush = useCallback((limit = FLUSH_LIMIT) => link.flush(limit), [link]);
  const giveUp = useCallback(() => link.giveUp(), [link]);

  return { state, setState, saving, signedOut, refused, unplayable, checking, ready, flush, giveUp };
}
