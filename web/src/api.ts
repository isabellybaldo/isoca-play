import type { Level } from './mahjong/layouts';
import type { Tile } from './mahjong/rules';
import type { Puzzle } from './sudoku/rules';

export type GameName = 'mahjong' | 'sudoku';

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

// The saved game, or null when there is none yet.
export async function loadSave(game: GameName): Promise<unknown> {
  return request(`/api/save/${game}`, {}, (response) => {
    checked(response);
    return response.status === 204 ? null : response.json();
  });
}

export async function putSave(game: GameName, body: unknown): Promise<void> {
  await request(`/api/save/${game}`, withJson('PUT', body), checked);
}

export async function newMahjong(layoutId: string): Promise<{ layout: string; tiles: Tile[] }> {
  return request('/api/new/mahjong', withJson('POST', { layout: layoutId }), (response) => checked(response).json());
}

// `not` is the board on screen, so a new game always changes it.
export async function newSudoku(level: Level, not?: string): Promise<Puzzle> {
  return request('/api/new/sudoku', withJson('POST', { level, not }), (response) => checked(response).json());
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
