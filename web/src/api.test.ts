import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadSave, logout, newSudoku, putSave, startNote } from './api';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// A server that never answers, as fetch sees one: it ends only when aborted.
function silentServer() {
  vi.stubGlobal(
    'fetch',
    (_path: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
}

test.each([
  ['loadSave', () => loadSave('sudoku')],
  ['putSave', () => putSave('sudoku', {})],
  ['newSudoku', () => newSudoku('easy')],
  ['logout', () => logout()],
])('%s gives up after 10 seconds', async (_name, call) => {
  silentServer();
  let outcome = 'waiting';
  void call().catch(() => {
    outcome = 'gave up';
  });
  await vi.advanceTimersByTimeAsync(9900);
  expect(outcome).toBe('waiting');
  await vi.advanceTimersByTimeAsync(200);
  expect(outcome).toBe('gave up');
});

test('a body that stalls after the headers also gives up', async () => {
  vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    json: () =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  }));
  let outcome = 'waiting';
  void loadSave('sudoku').catch(() => {
    outcome = 'gave up';
  });
  await vi.advanceTimersByTimeAsync(10_100);
  expect(outcome).toBe('gave up');
});

test('the note says why starting is not possible, the most pressing reason first', () => {
  const base = { online: true, ready: true, starting: false, problem: '', unplayable: false };
  expect(startNote(base)).toBe('');
  expect(startNote({ ...base, online: false, ready: false })).toBe('New games need a connection.');
  expect(startNote({ ...base, ready: false })).toBe('Loading your saved game.');
  expect(startNote({ ...base, starting: true })).toBe('Starting a new game.');
  expect(startNote({ ...base, problem: 'No.', unplayable: true })).toBe('No.');
  expect(startNote({ ...base, unplayable: true })).toBe('The saved game could not be opened.');
});
