import type { Level } from './mahjong/layouts';
import { CACHED_HEADER } from './offline';
import type { Tile } from './mahjong/rules';
import type { GameRecord } from './stats/run';
import type { Puzzle } from './sudoku/rules';

export type GameName = 'mahjong' | 'solitaire' | 'sudoku';

export class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`The server answered ${status}`);
    this.status = status;
  }
}

const TIMEOUT = 10_000;

// One request and the reading of its answer, ended by the abort if it takes too long.
async function request<T>(path: string, init: RequestInit, read: (response: Response) => T | Promise<T>): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT);
  try {
    return await read(await fetch(path, { ...init, signal: abort.signal }));
  } finally {
    clearTimeout(timer);
  }
}

const checked = (response: Response) => {
  if (!response.ok) throw new ApiError(response.status);
  return response;
};

const withJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// The saved game, or null when there is none yet. `cached` says the worker answered from
// the device because the network could not: the last save the server confirmed, which is
// not news about the server. No network and nothing kept is a failure, not a null.
export async function loadSave(game: GameName): Promise<{ body: unknown; cached: boolean }> {
  return request(`/api/save/${game}`, {}, async (response) => {
    checked(response);
    return {
      body: response.status === 204 ? null : await response.json(),
      cached: response.headers.has(CACHED_HEADER),
    };
  });
}

export async function putSave(game: GameName, body: unknown): Promise<void> {
  await request(`/api/save/${game}`, withJson('PUT', body), checked);
}

export async function sendGameRecord(record: GameRecord): Promise<void> {
  await request('/api/stats/game', withJson('POST', record), checked);
}

type Counted = {
  played: number;
  won: number;
  win_rate: number | null;
  avg_win_seconds: number | null;
  best_win_seconds: number | null;
};
export type GameTotals = Counted & {
  game: GameName;
  lost: number;
  abandoned: number;
  avg_returns: number | null;
  avg_tips: number | null;
  levels: (Counted & { level: Level })[];
};
export type MapTotals = Counted & { map: string; name: string; lost: number; abandoned: number };
export type StatsAnswer = {
  public: { games: GameTotals[]; maps: MapTotals[]; longest_streak: number } | null;
  private: { daily: { day: string; games: number }[]; current_streak: number };
};

export async function loadStats(today: string): Promise<StatsAnswer> {
  return request(`/api/stats?today=${encodeURIComponent(today)}`, {}, (response) => checked(response).json());
}

export async function newMahjong(layoutId: string): Promise<{ layout: string; tiles: Tile[] }> {
  return request('/api/new/mahjong', withJson('POST', { layout: layoutId }), (response) => checked(response).json());
}

// `not` is the board on screen, so a new game always changes it.
export async function newSudoku(level: Level, not?: string): Promise<Puzzle> {
  return request('/api/new/sudoku', withJson('POST', { level, not }), (response) => checked(response).json());
}

// `not` is the deal on screen, so a new game always changes it.
export async function newSolitaire(not?: number[]): Promise<{ deal: number[] }> {
  return request('/api/new/solitaire', withJson('POST', { not }), (response) => checked(response).json());
}

// The server answers with a redirect, which is ours to follow, so a page of login
// markup is not fetched only to be thrown away.
export async function logout(): Promise<void> {
  await request('/logout', { method: 'POST', redirect: 'manual' }, (response) => {
    if (response.type !== 'opaqueredirect') checked(response);
  });
}

export function goToLogin(): void {
  window.location.assign('/login');
}

// A log out past its patience leaves this page not knowing how it ended, and the page that
// could say so comes after a redirect. Session storage is enough to carry that: this tab,
// no further. Losing it, or having none, only loses the message.
const LOGOUT_UNCONFIRMED = 'isoca-play-logout-unconfirmed';
const LOGGED_IN_MARK = '#logged-in'; // on the server's redirect after a login

export function markLogoutUnconfirmed(): void {
  try {
    sessionStorage.setItem(LOGOUT_UNCONFIRMED, '1');
  } catch {
    // Only the message is lost.
  }
}

export function forgetLogoutUnconfirmed(): void {
  try {
    sessionStorage.removeItem(LOGOUT_UNCONFIRMED);
  } catch {
    // Nothing was kept, then.
  }
}

export function logoutUnconfirmed(): boolean {
  try {
    return sessionStorage.getItem(LOGOUT_UNCONFIRMED) !== null;
  } catch {
    return false;
  }
}

// A page that has just logged in: whatever an earlier log out did, this session is new.
export function takeLoggedInMark(): void {
  if (window.location.hash !== LOGGED_IN_MARK) return;
  forgetLogoutUnconfirmed();
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

export const REPLACE_UNPLAYABLE = 'The saved game could not be opened. A new game replaces it.';

// The one line under the start buttons, saying why they can't be used or what is going on.
export function startNote({
  online,
  ready = true,
  starting,
  problem,
  unplayable = false,
}: {
  online: boolean;
  ready?: boolean;
  starting: boolean;
  problem: string;
  unplayable?: boolean;
}): string {
  if (!online) return 'New games need a connection.';
  if (!ready) return 'Loading your saved game.';
  if (starting) return 'Starting a new game.';
  if (problem) return problem;
  return unplayable ? 'The saved game could not be opened.' : '';
}

export function newGameProblem(error: unknown): string {
  return error instanceof ApiError && error.status === 401
    ? 'Log in again to start a new game.'
    : 'That did not work. Try again.';
}
