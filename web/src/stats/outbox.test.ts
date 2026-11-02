import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearDevice } from '../offline';
import { addRecords, sendRecords, OUTBOX_KEY } from './outbox';
import type { GameRecord } from './run';

const record = (id: string): GameRecord => ({
  id, game: 'sudoku', level: 'easy', result: 'won', day: '2026-11-02', days: ['2026-11-02'],
  seconds: 1, returns: 0, tips: 0, map: null, slots: null, moves: null, unsolved: 0, turns: null,
});

const kept = () => (JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as GameRecord[]).map((r) => r.id);

function answering(statusOf: (id: string) => number | Error) {
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_path: string, init: RequestInit) => {
    const { id } = JSON.parse(init.body as string) as GameRecord;
    sent.push(id);
    const answer = statusOf(id);
    if (answer instanceof Error) throw answer;
    return new Response(null, { status: answer });
  }));
  return sent;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the outbox', () => {
  test('a record added twice is kept once, by id', () => {
    addRecords([record('a')]);
    addRecords([record('a'), record('b')]);
    expect(kept()).toEqual(['a', 'b']);
  });

  test('a sent record leaves the outbox', async () => {
    const sent = answering(() => 204);
    addRecords([record('a'), record('b')]);
    await sendRecords();
    expect(sent).toEqual(['a', 'b']);
    expect(kept()).toEqual([]);
  });

  test('a refused record (400) is dropped, and the rest still go', async () => {
    const sent = answering((id) => (id === 'a' ? 400 : 204));
    addRecords([record('a'), record('b')]);
    await sendRecords();
    expect(sent).toEqual(['a', 'b']);
    expect(kept()).toEqual([]);
  });

  test.each([
    ['a network failure', new TypeError('no network')],
    ['a 401', 401],
    ['a 500', 500],
  ])('%s keeps everything, and stops sending', async (_name, answer) => {
    const sent = answering(() => answer);
    addRecords([record('a'), record('b')]);
    await sendRecords();
    expect(sent).toEqual(['a']);
    expect(kept()).toEqual(['a', 'b']);
  });

  test('denied storage throws nowhere and sends nothing', async () => {
    const sent = answering(() => 204);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => addRecords([record('a')])).not.toThrow();
    await expect(sendRecords()).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });

  test('storage that reads but will not write sends each record once, not forever', async () => {
    const sent = answering(() => 204);
    addRecords([record('a')]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    await sendRecords();
    expect(sent).toEqual(['a']);
  });

  test.each(['not json', '{"a":1}', '[1,2]'])('%s in storage reads as empty', async (stored) => {
    const sent = answering(() => 204);
    localStorage.setItem(OUTBOX_KEY, stored);
    await sendRecords();
    expect(sent).toEqual([]);
    addRecords([record('a')]);
    expect(kept()).toEqual(['a']);
  });

  test('the outbox holds at most 500, dropping the oldest', () => {
    addRecords(Array.from({ length: 502 }, (_, i) => record(`r${i}`)));
    const ids = kept();
    expect(ids).toHaveLength(500);
    expect(ids[0]).toBe('r2');
  });

  test('two sends at once do not send a record twice', async () => {
    const sent = answering(() => 204);
    addRecords([record('a')]);
    await Promise.all([sendRecords(), sendRecords()]);
    expect(sent).toEqual(['a']);
  });

  test('a record added while sending is kept', async () => {
    const sent = answering((id) => {
      if (id === 'a') addRecords([record('b')]);
      return 204;
    });
    addRecords([record('a')]);
    await sendRecords();
    expect(sent).toEqual(['a', 'b']);
    expect(kept()).toEqual([]);
  });

  test('clearing the device empties the outbox', async () => {
    addRecords([record('a')]);
    await clearDevice();
    expect(kept()).toEqual([]);
  });
});
