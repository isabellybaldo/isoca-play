import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from '../App';
import { blanked, fakeServer, SOLUTION } from '../fakeServer.testutil';
import { newSudoku, type SudokuState } from '../sudoku/rules';
import type { GameRecord } from './run';
import { useTracked } from './useTracked';

const entry = { cell: 0, value: 0, notes: 0 };

// A save link with nothing behind it: the state, and what gives up on it.
function holder(start: SudokuState & { run?: never }) {
  const saved = {
    state: start as ReturnType<typeof newSudoku> | null,
    setState: (action: unknown) => {
      const update = action as (s: unknown) => SudokuState | null;
      saved.state = update(saved.state);
    },
    giveUp: vi.fn(),
  };
  return saved;
}

const outbox = () => JSON.parse(localStorage.getItem('isoca-play-stats-outbox') ?? '[]') as GameRecord[];

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the clock', () => {
  function setup() {
    fakeServer();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const saved = holder(newSudoku(blanked('easy', [0, 1, 2])) as never);
    const { result } = renderHook(() => useTracked('sudoku', saved as never));
    // A first change gives the game its run.
    act(() => result.current.onGame((s) => ({ ...(s as SudokuState), puzzle: blanked('easy', [0, 1, 3]) })));
    const move = () =>
      act(() => result.current.onGame((s) => ({ ...(s as SudokuState), history: [...(s as SudokuState).history, entry] })));
    return { saved, result, move, pass: (ms: number) => (now += ms) };
  }

  const seconds = (saved: { state: unknown }) => (saved.state as { run: { seconds: number } }).run.seconds;

  test('runs only on the game screen', () => {
    const { saved, result, move, pass } = setup();
    pass(60_000); // not on the screen yet
    act(() => result.current.tracker.onScreen(true));
    pass(5_000);
    act(() => result.current.tracker.onScreen(false));
    pass(60_000);
    move();
    expect(seconds(saved)).toBe(5);
  });

  test('stops while the page is hidden', () => {
    const { saved, result, move, pass } = setup();
    act(() => result.current.tracker.onScreen(true));
    pass(3_000);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    pass(3_600_000);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    pass(2_000);
    move();
    expect(seconds(saved)).toBe(5);
  });

  test('time is counted once, not again on the next move', () => {
    const { saved, result, move, pass } = setup();
    act(() => result.current.tracker.onScreen(true));
    pass(5_000);
    move();
    move();
    expect(seconds(saved)).toBe(5);
  });

  test('a tip goes in with the next move', () => {
    const { saved, result, move } = setup();
    act(() => result.current.tracker.tip());
    move();
    expect((saved.state as unknown as { run: { tips: number } }).run.tips).toBe(1);
  });

  test('the crash screen new game records the game as abandoned', () => {
    const { saved, result, move } = setup();
    move();
    act(() => result.current.giveUp());
    expect(outbox().map((r) => r.result)).toEqual(['abandoned']);
    expect(saved.giveUp).toHaveBeenCalledOnce();
  });
});

describe('in the app', () => {
  const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

  async function startEasySudoku() {
    const server = fakeServer();
    const user = userEvent.setup();
    render(<App />);
    await settle();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    await screen.findByRole('group', { name: 'Board' });
    const write = async (cell: number, digit: number) => {
      await user.click(within(screen.getByRole('group', { name: 'Board' })).getAllByRole('button')[cell]);
      await user.click(within(screen.getByRole('group', { name: 'Numbers' })).getByRole('button', { name: String(digit) }));
    };
    const records = () => server.requests.filter((r) => r.path === '/api/stats/game').map((r) => r.body as GameRecord);
    return { server, user, write, records };
  }

  const sol = (cell: number) => Number(SOLUTION[cell]);

  test('playing to a win sends one record with the returns and tips made', async () => {
    const { user, write, records } = await startEasySudoku();
    await write(0, sol(0));
    await user.click(screen.getByRole('button', { name: 'Tip' }));
    await user.click(screen.getByRole('button', { name: 'Return' }));
    await write(0, sol(0));
    await write(1, sol(1));
    expect(records()).toEqual([]);
    await write(2, sol(2));
    await settle();
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({ game: 'sudoku', level: 'easy', result: 'won', returns: 1, tips: 1, unsolved: 0 });
    expect(records()[0].days).toHaveLength(1);
    expect(records()[0].days[0]).toBe(records()[0].day);
  });

  test('starting a new game over one with moves sends an abandoned record', async () => {
    const { user, write, records } = await startEasySudoku();
    await write(0, sol(0));
    await user.click(screen.getByRole('button', { name: 'New game' }));
    await user.click(screen.getByRole('button', { name: 'Start new game' }));
    await settle();
    expect(records().map((r) => r.result)).toEqual(['abandoned']);
  });

  test('a deal replaced with no moves sends nothing', async () => {
    const { user, records } = await startEasySudoku();
    await user.click(screen.getByRole('button', { name: 'New game' }));
    await settle();
    expect(records()).toEqual([]);
  });

  test('a tip with no move sends no save', async () => {
    const { server, user, write } = await startEasySudoku();
    await write(0, sol(0));
    await settle();
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    const before = server.puts('sudoku').length;
    await user.click(screen.getByRole('button', { name: 'Tip' }));
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    expect(server.puts('sudoku')).toHaveLength(before);
  });

  test('the counters ride in the save, and a game save still goes when stats fail', async () => {
    const { server, write } = await startEasySudoku();
    server.answer = (seen) => (seen.path === '/api/stats/game' ? 500 : undefined);
    await write(0, sol(0));
    await write(1, sol(1));
    await write(2, sol(2));
    await settle();
    expect(screen.getByText('You won.')).toBeTruthy();
    expect(outbox()).toHaveLength(1);
    await vi.waitFor(() => expect((server.saves.sudoku as { run?: unknown; status: string }).status).toBe('won'));
    expect((server.saves.sudoku as { run: { done: boolean } }).run.done).toBe(true);
  });

  test('what waited in the outbox goes on load', async () => {
    const waiting = { id: 'w1', game: 'sudoku', level: 'easy', result: 'won', day: '2026-11-02', days: [], seconds: 1, returns: 0, tips: 0, map: null, slots: null, moves: null, unsolved: 0, turns: null };
    localStorage.setItem('isoca-play-stats-outbox', JSON.stringify([waiting]));
    const server = fakeServer();
    render(<App />);
    await settle();
    expect(server.requests.filter((r) => r.path === '/api/stats/game')).toHaveLength(1);
    expect(outbox()).toEqual([]);
  });
});

test('the worker does not keep the stats routes', () => {
  const source = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'sw.js'), 'utf8');
  const savePath = /const SAVE_PATH = (\/.*\/);/.exec(source)![1];
  const pattern = new RegExp(savePath.slice(1, -1));
  expect(pattern.test('/api/stats')).toBe(false);
  expect(pattern.test('/api/stats/game')).toBe(false);
  expect(source).not.toContain('/api/stats');
});
