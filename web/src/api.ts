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

async function send(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, init);
  if (!response.ok) throw new ApiError(response.status);
  return response;
}

const withJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// The saved game, or null when there is none yet.
export async function loadSave(game: GameName): Promise<unknown> {
  const response = await send(`/api/save/${game}`);
  return response.status === 204 ? null : response.json();
}

export async function putSave(game: GameName, body: unknown): Promise<void> {
  await send(`/api/save/${game}`, withJson('PUT', body));
}

export async function newMahjong(layoutId: string): Promise<{ layout: string; tiles: Tile[] }> {
  const response = await send('/api/new/mahjong', withJson('POST', { layout: layoutId }));
  return response.json();
}

// `not` is the board on screen, so a new game always changes it.
export async function newSudoku(level: Level, not?: string): Promise<Puzzle> {
  const response = await send('/api/new/sudoku', withJson('POST', { level, not }));
  return response.json();
}

// The server answers with a redirect, which is ours to follow, so a page of login
// markup is not fetched only to be thrown away.
export async function logout(): Promise<void> {
  const response = await fetch('/logout', { method: 'POST', redirect: 'manual' });
  if (response.type !== 'opaqueredirect' && !response.ok) throw new ApiError(response.status);
}

export function goToLogin(): void {
  window.location.assign('/login');
}

export const OFFLINE_NOTE = 'New games need a connection.';

export function newGameProblem(error: unknown): string {
  return error instanceof ApiError && error.status === 401
    ? 'Log in again to start a new game.'
    : 'That did not work. Try again.';
}
