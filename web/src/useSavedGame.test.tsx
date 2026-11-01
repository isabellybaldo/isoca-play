import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { blanked, fakeServer, goOffline } from './fakeServer.testutil';
import { newSudoku } from './sudoku/rules';
import { useSavedGame } from './useSavedGame';

const P = blanked('easy', [0, 1, 2]);
const game = (selected: number) => ({ ...newSudoku(P), selected });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pass = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function opened() {
  const view = renderHook(() => useSavedGame('sudoku'));
  await pass();
  return view;
}

test('a saved game comes back as it was stored, and the load itself saves nothing', async () => {
  const server = fakeServer({ sudoku: game(7) });
  const { result } = await opened();
  expect(result.current.state).toEqual(game(7));
  expect(result.current.ready).toBe(true);
  expect(result.current.saving).toBe('saved');
  expect(server.puts('sudoku')).toEqual([]);
});

test('no save means no game, and a save of the wrong shape counts as none', async () => {
  fakeServer();
  const none = await opened();
  expect(none.result.current.state).toBeNull();
  expect(none.result.current.ready).toBe(true);
  none.unmount();

  fakeServer({ sudoku: { nonsense: true } });
  const odd = await opened();
  expect(odd.result.current.state).toBeNull();
  expect(odd.result.current.ready).toBe(true);
});

test('every move saves when online', async () => {
  const server = fakeServer();
  const { result } = await opened();
  for (const n of [1, 2, 3]) {
    act(() => result.current.setState(game(n)));
    await pass();
  }
  expect(server.puts('sudoku')).toEqual([game(1), game(2), game(3)]);
  expect(server.saves.sudoku).toEqual(game(3));
  expect(result.current.saving).toBe('saved');
});

test('an update that changes nothing does not save', async () => {
  const server = fakeServer();
  const { result } = await opened();
  act(() => result.current.setState(game(1)));
  await pass();
  act(() => result.current.setState((s) => s));
  await pass();
  expect(server.puts('sudoku')).toHaveLength(1);
});

test('moves made during a save go out together when it returns, the latest only', async () => {
  const server = fakeServer();
  const { result } = await opened();
  act(() => result.current.setState(game(1)));
  act(() => result.current.setState(game(2)));
  act(() => result.current.setState(game(3)));
  await pass();
  expect(server.puts('sudoku')).toEqual([game(1), game(3)]);
});

test('a failed save shows the marker, retries, and stores only the latest state', async () => {
  const server = fakeServer();
  const { result } = await opened();
  server.answer = () => 503;

  act(() => result.current.setState(game(1)));
  await pass();
  expect(result.current.saving).toBe('retrying');
  act(() => result.current.setState(game(2)));
  act(() => result.current.setState(game(3)));
  await pass(500);
  expect(server.puts('sudoku')).toEqual([game(1)]); // waiting out the backoff

  server.answer = null;
  await pass(600);
  expect(server.puts('sudoku')).toEqual([game(1), game(3)]);
  expect(server.saves.sudoku).toEqual(game(3));
  expect(result.current.saving).toBe('saved');
});

test('the backoff doubles up to 30 seconds and does not pass it', async () => {
  const server = fakeServer();
  const { result } = await opened();
  server.answer = () => 503;
  act(() => result.current.setState(game(1)));
  await pass();
  const tries = () => server.puts('sudoku').length;
  for (const wait of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const before = tries();
    await pass(wait - 100);
    expect(tries()).toBe(before);
    await pass(100);
    expect(tries()).toBe(before + 1);
  }
});

test('a network failure offline says offline, and coming back online saves at once', async () => {
  const server = fakeServer();
  const { result } = await opened();
  server.answer = () => {
    throw new TypeError('Failed to fetch');
  };
  goOffline();
  act(() => result.current.setState(game(1)));
  await pass();
  expect(result.current.saving).toBe('offline');
  expect(result.current.state).toEqual(game(1));

  server.answer = null;
  await act(async () => goOffline(false));
  await pass();
  expect(server.saves.sudoku).toEqual(game(1));
  expect(result.current.saving).toBe('saved');
});

test('a 401 says so, keeps the game in memory, and saves once signed in again', async () => {
  const server = fakeServer();
  const { result } = await opened();
  server.answer = () => 401;
  act(() => result.current.setState(game(1)));
  await pass();
  expect(result.current.signedOut).toBe(true);
  expect(result.current.state).toEqual(game(1));

  server.answer = null;
  await pass(1000);
  expect(result.current.signedOut).toBe(false);
  expect(server.saves.sudoku).toEqual(game(1));
});

test('a save never overwrites a game that has not finished loading', async () => {
  const server = fakeServer({ sudoku: game(9) });
  server.answer = ({ method }) => (method === 'GET' ? 503 : undefined);
  const { result } = await opened();
  expect(result.current.ready).toBe(false);

  act(() => result.current.setState(game(1)));
  await pass();
  expect(result.current.state).toBeNull();
  expect(server.puts('sudoku')).toEqual([]);

  server.answer = null;
  await pass(1000); // the load retries too
  expect(result.current.ready).toBe(true);
  expect(result.current.state).toEqual(game(9));
  expect(server.puts('sudoku')).toEqual([]);
  expect(server.saves.sudoku).toEqual(game(9));
});

test('flush waits for what is still going out', async () => {
  const server = fakeServer();
  const { result } = await opened();
  act(() => result.current.setState(game(1)));
  await act(async () => {
    await result.current.flush();
  });
  expect(server.saves.sudoku).toEqual(game(1));
});

test('flush gives up after its time limit', async () => {
  const server = fakeServer();
  const { result } = await opened();
  server.answer = () => 503;
  act(() => result.current.setState(game(1)));
  let done = false;
  void result.current.flush(3000).then(() => {
    done = true;
  });
  await pass(2900);
  expect(done).toBe(false);
  await pass(200);
  expect(done).toBe(true);
});
