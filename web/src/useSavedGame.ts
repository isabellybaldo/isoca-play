import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { ApiError, loadSave, putSave, type GameName } from './api';
import { LAYOUTS } from './mahjong/layouts';
import type { MahjongState } from './mahjong/rules';
import { isHistoryEntry, type SolitaireState } from './solitaire/rules';
import type { SudokuState } from './sudoku/rules';

// A mahjong save names its layout, and the app looks the shape up. A sudoku state
// already holds its puzzle.
export type MahjongSave = { layout: string; state: MahjongState };
export type Saved = { mahjong: MahjongSave; solitaire: SolitaireState; sudoku: SudokuState };
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

const isCards = (value: unknown): value is number[] =>
  isNumbers(value) && value.every((n) => Number.isInteger(n) && n >= 0 && n < 52);

// All 52 cards are somewhere, once each, and undo can read the history. Unknown fields are
// welcome. The rules own what a legal position is.
function isPlayableSolitaire(body: unknown): boolean {
  if (!isRecord(body) || !isCards(body.deal) || body.deal.length !== 52 || new Set(body.deal).size !== 52) return false;
  const { stock, waste, columns, foundations, history, status } = body;
  if (!isCards(stock) || !isCards(waste)) return false;
  if (!Array.isArray(columns) || columns.length !== 7) return false;
  if (!columns.every((c) => isRecord(c) && isCards(c.down) && isCards(c.up))) return false;
  if (!isNumbers(foundations) || foundations.length !== 4) return false;
  if (!foundations.every((n) => Number.isInteger(n) && n >= 0 && n <= 13)) return false;
  const cards = [
    ...stock,
    ...waste,
    ...(columns as { down: number[]; up: number[] }[]).flatMap((c) => [...c.down, ...c.up]),
    ...foundations.flatMap((count, suit) => Array.from({ length: count }, (_, i) => suit * 13 + i)),
  ];
  return (
    cards.length === 52 &&
    new Set(cards).size === 52 &&
    Array.isArray(history) &&
    history.every(isHistoryEntry) &&
    ['playing', 'won'].includes(status as string)
  );
}

const PLAYABLE: Record<GameName, (body: unknown) => boolean> = {
  mahjong: isPlayableMahjong,
  solitaire: isPlayableSolitaire,
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
  solitaire: (a, b) => a.deal !== b.deal || a.history !== b.history,
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
  signedIn: () => void;
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
// An answer from the worker's cache is only ever a starting point. On a load it shows the
// last confirmed game and says so, and nothing is unsent, so nothing goes back to the
// server. On a check it is ignored: it can only be as old as what this tab has, or older.
// Until a real answer comes, this tab keeps asking with a growing wait: the first request
// after a connection returns can fail, and no further wake may come. Those checks run in
// the background: moves apply at once, and if the server turns out to have something newer
// the moves still stand as unsent, last save wins.
//
// Tabs tell each other two things. "loaded": a tab has just opened, perhaps after a log
// in, so one waiting with unsent moves tries now. "saved": there is something new to
// fetch. In that order, a tab opened to log in ends up with the moves of the tab that
// sent it there.
//
// A check is a refresh that says what it heard, for a screen about to write with no tap:
// true only if the server itself says it holds nothing and this tab has nothing either. It
// rejects when no answer came. What the server holds is taken as in any refresh.
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
  let fromCache = false; // the last thing heard came from the device, not the server
  let checks = 0;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let channel: BroadcastChannel | undefined;
  let held: Action[] = [];
  const waiting: ((sent: boolean) => void)[] = [];
  let asks: { resolve: (clear: boolean) => void; reject: (error: unknown) => void }[] = [];

  const settle = (sent: boolean) => {
    for (const done of waiting.splice(0)) done(sent);
  };
  const post = (type: 'loaded' | 'saved') => channel?.postMessage({ game, type });
  const noAnswer = (error: unknown) => {
    for (const ask of asks.splice(0)) ask.reject(error);
  };
  const stopTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const heardFromCache = () => {
    fromCache = true;
    screen.saving('offline');
    askAgainLater();
  };
  const heardFromServer = () => {
    fromCache = false;
    checks = 0;
    clearTimeout(checkTimer);
    screen.signedIn();
  };
  const askAgainLater = () => {
    clearTimeout(checkTimer);
    if (!mounted) return;
    checkTimer = setTimeout(() => void refresh(), Math.min(FIRST_WAIT * 2 ** checks, LONGEST_WAIT));
    checks += 1;
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
    noAnswer(error);
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
    let posting: 'loaded' | 'saved' | null;
    let cachedAnswer = false;
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
        const { body, cached } = await loadSave(game);
        cachedAnswer = cached;
        savedText = JSON.stringify(body);
        const good = playable(body);
        state = good ? (body as State) : null;
        ready = true;
        screen.show(state);
        screen.unplayable(body !== null && !good);
        screen.ready();
        posting = cached ? null : 'loaded'; // the other tabs would not reach the server either
      }
    } catch (error) {
      failed(error);
      return;
    }
    busy = false;
    failures = 0;
    refused = false;
    screen.refused(false);
    if (cachedAnswer) {
      heardFromCache();
    } else {
      heardFromServer();
      screen.saving('saved');
      screen.signedOut(false);
    }
    if (posting) post(posting);
    finish();
  }

  async function refresh() {
    if (!ready || busy) {
      again = true;
      return;
    }
    again = false;
    if (unsent || timer !== undefined) {
      noAnswer(new Error('a save is still on its way'));
      return;
    }
    const answering = asks;
    asks = [];
    let empty = false;
    let problem: unknown;
    busy = true;
    refreshing = !fromCache;
    const note = setTimeout(() => screen.checking(true), CHECKING_NOTE_AFTER);
    let adopted = false;
    try {
      const { body, cached } = await loadSave(game);
      const text = JSON.stringify(body);
      empty = !cached && body === null;
      if (!cached && !unsent && body !== null && text !== savedText) {
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
      if (cached) {
        heardFromCache();
      } else {
        heardFromServer();
        if (!unsent) screen.saving('saved');
        screen.signedOut(false);
      }
    } catch (error) {
      // No answer: this tab carries on with what it has, and the next wake asks again.
      problem = error ?? new Error('no answer');
      if (error instanceof ApiError && error.status === 401) screen.signedOut(true);
      if (fromCache) askAgainLater();
    }
    clearTimeout(note);
    screen.checking(false);
    busy = false;
    refreshing = false;
    const moves = held;
    held = [];
    if (!adopted) for (const action of moves) apply(action);
    for (const ask of answering) {
      if (problem) ask.reject(problem);
      else ask.resolve(empty && state === null);
    }
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
      clearTimeout(checkTimer);
      for (const ask of asks.splice(0)) ask.resolve(false);
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
    check() {
      return new Promise<boolean>((resolve, reject) => {
        asks.push({ resolve, reject });
        void refresh();
      });
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
  const [signedIn, setSignedIn] = useState(false); // the server itself has answered, since boot
  const [refused, setRefused] = useState(false);
  const [unplayable, setUnplayable] = useState(false);
  const [checking, setChecking] = useState(false);

  const [link] = useState(() =>
    createLink(game, {
      show: setShown,
      ready: () => setReady(true),
      saving: setSaving,
      signedOut: setSignedOut,
      signedIn: () => setSignedIn(true),
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
  const check = useCallback(() => link.check(), [link]);

  return { state, setState, saving, signedOut, signedIn, refused, unplayable, checking, ready, flush, giveUp, check };
}
