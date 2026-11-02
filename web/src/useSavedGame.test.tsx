import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { blanked, fakeServer, goOffline } from './fakeServer.testutil';
import { LAYOUTS } from './mahjong/layouts';
import { isFree, newGame, tap, tapElsewhere } from './mahjong/rules';
import { newSolitaire, tapPile, type SolitaireState } from './solitaire/rules';
import { newSudoku, pressDigit, selectCell, setMode } from './sudoku/rules';
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

const SUDOKU_OK = game(0);
test.each([
  ['the short shape', { puzzle: { givens: P.givens, solution: P.solution }, values: SUDOKU_OK.values, notes: SUDOKU_OK.notes, history: [] }],
  ['an unknown level', { ...SUDOKU_OK, puzzle: { ...P, level: 'brutal' } }],
  ['short givens', { ...SUDOKU_OK, puzzle: { ...P, givens: '1.' } }],
  ['short solution', { ...SUDOKU_OK, puzzle: { ...P, solution: '1' } }],
  ['short values', { ...SUDOKU_OK, values: [1, 2] }],
  ['short notes', { ...SUDOKU_OK, notes: [0] }],
  ['history not a list', { ...SUDOKU_OK, history: 'x' }],
  ['an unknown status', { ...SUDOKU_OK, status: 'maybe' }],
  ['an unknown mode', { ...SUDOKU_OK, mode: 'pen' }],
])('a sudoku save with %s cannot be opened', async (_name, body) => {
  const server = fakeServer({ sudoku: body });
  const { result } = await opened();
  expect(result.current.state).toBeNull();
  expect(result.current.unplayable).toBe(true);
  expect(result.current.ready).toBe(true);
  expect(server.puts('sudoku')).toEqual([]);
});

const FRAME = LAYOUTS[0];
const DEALT = newGame(FRAME.cells.map((c, id) => ({ id, ...c, face: 'cat' })));
test.each([
  ['an unknown layout', { layout: 'nope', state: DEALT }],
  ['tiles that are not tiles', { layout: FRAME.id, state: { ...DEALT, tiles: [1, 2] } }],
  ['a tile with no face', { layout: FRAME.id, state: { ...DEALT, tiles: [{ id: 0, x: 0, y: 0, z: 0 }] } }],
  ['no board', { layout: FRAME.id, state: { ...DEALT, onBoard: null } }],
  ['no slots', { layout: FRAME.id, state: { ...DEALT, slots: 'x' } }],
  ['a slot holding no tile', { layout: FRAME.id, state: { ...DEALT, slots: [9999] } }],
  ['no history', { layout: FRAME.id, state: { ...DEALT, history: {} } }],
])('a mahjong save with %s cannot be opened', async (_name, body) => {
  fakeServer({ mahjong: body });
  const { result } = renderHook(() => useSavedGame('mahjong'));
  await pass();
  expect(result.current.state).toBeNull();
  expect(result.current.unplayable).toBe(true);
});

test('a good save is playable, and no save is not a bad one', async () => {
  fakeServer({ sudoku: SUDOKU_OK, mahjong: { layout: FRAME.id, state: DEALT } });
  const sudoku = await opened();
  expect(sudoku.result.current.unplayable).toBe(false);
  expect(sudoku.result.current.state).toEqual(SUDOKU_OK);
  const mahjong = renderHook(() => useSavedGame('mahjong'));
  await pass();
  expect(mahjong.result.current.unplayable).toBe(false);
  cleanup();
  fakeServer();
  const none = await opened();
  expect(none.result.current.unplayable).toBe(false);
});

test('a selection or a change of mode is not a move, and sends nothing', async () => {
  const server = fakeServer({ sudoku: SUDOKU_OK });
  const { result } = await opened();
  act(() => result.current.setState((s) => selectCell(s!, 0)));
  act(() => result.current.setState((s) => setMode(s!, 'notes')));
  await pass();
  expect(result.current.state!.selected).toBe(0);
  expect(result.current.state!.mode).toBe('notes');
  expect(server.puts('sudoku')).toEqual([]);

  act(() => result.current.setState((s) => pressDigit(s!, 3)));
  await pass();
  expect(server.puts('sudoku')).toHaveLength(1);
});

test('a mahjong selection sends nothing; the move does', async () => {
  const server = fakeServer({ mahjong: { layout: FRAME.id, state: DEALT } });
  const { result } = renderHook(() => useSavedGame('mahjong'));
  await pass();
  const change = (f: typeof tapElsewhere) =>
    act(() => result.current.setState((g) => ({ ...g!, state: f(g!.state) })));
  const id = DEALT.tiles.find((t) => isFree(DEALT, t.id))!.id;
  change((s) => tap(s, id));
  await pass();
  change(tapElsewhere);
  await pass();
  change((s) => tap(s, id));
  await pass();
  expect(server.puts('mahjong')).toEqual([]);
  change((s) => tap(s, id));
  await pass();
  expect(server.puts('mahjong')).toHaveLength(1);
});

describe('a solitaire save', () => {
  const DEAL = Array.from({ length: 52 }, (_, i) => i);
  const OK = newSolitaire(DEAL);
  const PLAYED = tapPile(OK);
  const openSolitaire = async () => {
    const view = renderHook(() => useSavedGame('solitaire'));
    await pass();
    return view;
  };

  test.each<[string, unknown]>([
    ['not an object', 'nope'],
    ['a deal of 51 cards', { ...OK, deal: DEAL.slice(1) }],
    ['a deal of 53 cards', { ...OK, deal: [...DEAL, 0] }],
    ['a deal with a card twice', { ...OK, deal: [0, ...DEAL.slice(1, 51), 0] }],
    ['a deal with no such card', { ...OK, deal: [52, ...DEAL.slice(1)] }],
    ['a deal of words', { ...OK, deal: DEAL.map(String) }],
    ['a card missing from the piles', { ...OK, stock: OK.stock.slice(1) }],
    ['a card too many in the piles', { ...OK, waste: [OK.stock[0]] }],
    ['a card too many on the answer piles', { ...OK, foundations: [1, 0, 0, 0] }],
    ['a pile holding no such card', { ...OK, stock: [99, ...OK.stock.slice(1)] }],
    ['six columns', { ...OK, columns: OK.columns.slice(1) }],
    ['a column with no up', { ...OK, columns: [{ down: [] }, ...OK.columns.slice(1)] }],
    ['three answer piles', { ...OK, foundations: [0, 0, 0] }],
    ['an answer pile too high', { ...OK, stock: OK.stock.slice(14), foundations: [14, 0, 0, 0] }],
    ['an answer pile below nothing', { ...OK, stock: [...OK.stock, 0], foundations: [-1, 0, 0, 0] }],
    ['an unknown status', { ...OK, status: 'lost' }],
    ['no status', { ...OK, status: undefined }],
    ['no history', { ...OK, history: {} }],
    ['a history entry that is no move', { ...OK, history: ['d', 'nonsense'] }],
    ['a history entry that is no string', { ...OK, history: [7] }],
  ])('with %s cannot be opened', async (_name, body) => {
    const server = fakeServer({ solitaire: body });
    const { result } = await openSolitaire();
    expect(result.current.state).toBeNull();
    expect(result.current.unplayable).toBe(true);
    expect(server.puts('solitaire')).toEqual([]);
  });

  test.each<[string, unknown]>([
    ['a new deal', OK],
    ['moves', PLAYED],
    ['a win', { ...OK, stock: [], columns: OK.columns.map(() => ({ down: [], up: [] })), foundations: [13, 13, 13, 13], history: ['c0>f0:1'], status: 'won' }],
    ['unknown extra fields', { ...PLAYED, later: { any: 'thing' } }],
  ])('with %s opens', async (_name, body) => {
    fakeServer({ solitaire: body });
    const { result } = await openSolitaire();
    expect(result.current.unplayable).toBe(false);
    expect(result.current.state).toEqual(body);
  });

  test.each<[string, (s: SolitaireState) => SolitaireState, number]>([
    ['a change of deal', (s) => ({ ...s, deal: [...s.deal] }), 1],
    ['a change of history', (s) => ({ ...s, history: [...s.history] }), 1],
    ['anything else', (s) => ({ ...s, stock: [...s.stock] }), 0],
  ])('%s decides whether it is a move', async (_name, change, puts) => {
    const server = fakeServer({ solitaire: OK });
    const { result } = await openSolitaire();
    act(() => result.current.setState((s) => change(s!)));
    await pass();
    expect(server.puts('solitaire')).toHaveLength(puts);
  });
});

const wake = {
  focus: () => window.dispatchEvent(new Event('focus')),
  online: () => window.dispatchEvent(new Event('online')),
  visible: () => document.dispatchEvent(new Event('visibilitychange')),
};

test.each(Object.entries(wake))('waking by %s fetches and takes newer moves', async (_name, fire) => {
  const server = fakeServer({ sudoku: game(1) });
  const { result } = await opened();
  server.saves.sudoku = game(2);
  fire();
  await pass();
  expect(result.current.state).toEqual(game(2));
  expect(server.puts('sudoku')).toEqual([]);
});

test('waking with nothing new keeps the selection', async () => {
  fakeServer({ sudoku: SUDOKU_OK });
  const { result } = await opened();
  act(() => result.current.setState((s) => selectCell(s!, 40)));
  wake.focus();
  await pass();
  expect(result.current.state!.selected).toBe(40);
});

test('waking with unsent moves stores them over newer ones: last save wins', async () => {
  const server = fakeServer({ sudoku: game(1) });
  const { result } = await opened();
  server.answer = () => 503;
  act(() => result.current.setState(game(5)));
  await pass();
  server.answer = null;
  server.saves.sudoku = game(9);
  wake.online();
  await pass();
  expect(server.saves.sudoku).toEqual(game(5));
  expect(result.current.state).toEqual(game(5));
});

test('a move during the check waits, and is dropped if the server had newer ones', async () => {
  const server = fakeServer({ sudoku: game(1) });
  const { result } = await opened();
  let open = () => {};
  server.gate = new Promise<void>((resolve) => (open = resolve));
  server.saves.sudoku = game(2);
  wake.focus();
  await pass();
  act(() => result.current.setState(game(7)));
  await pass();
  expect(result.current.state).toEqual(game(1));
  expect(server.puts('sudoku')).toEqual([]);

  server.gate = null;
  open();
  await pass();
  expect(result.current.state).toEqual(game(2));
  expect(server.puts('sudoku')).toEqual([]);
});

test('a move during the check goes ahead if the server had nothing newer', async () => {
  const server = fakeServer({ sudoku: game(1) });
  const { result } = await opened();
  let open = () => {};
  server.gate = new Promise<void>((resolve) => (open = resolve));
  wake.focus();
  await pass();
  act(() => result.current.setState(game(7)));
  server.gate = null;
  open();
  await pass();
  expect(result.current.state).toEqual(game(7));
  expect(server.saves.sudoku).toEqual(game(7));
});

test('a slow check says so after a second, and clears', async () => {
  const server = fakeServer({ sudoku: game(1) });
  const { result } = await opened();
  let open = () => {};
  server.gate = new Promise<void>((resolve) => (open = resolve));
  wake.focus();
  await pass(900);
  expect(result.current.checking).toBe(false);
  await pass(200);
  expect(result.current.checking).toBe(true);
  server.gate = null;
  open();
  await pass();
  expect(result.current.checking).toBe(false);
});

test('a check with no answer leaves the game as it is, and moves go on', async () => {
  const server = fakeServer({ sudoku: game(1) });
  const { result } = await opened();
  server.answer = () => 503;
  wake.focus();
  await pass();
  expect(result.current.state).toEqual(game(1));
  server.answer = null;
  act(() => result.current.setState(game(2)));
  await pass();
  expect(server.saves.sudoku).toEqual(game(2));
});

test.each([400, 403, 413])('a %i stops retrying and says so; the next move tries again', async (status) => {
  const server = fakeServer();
  const { result } = await opened();
  server.answer = () => status;
  act(() => result.current.setState(game(1)));
  await pass();
  expect(result.current.refused).toBe(true);
  expect(result.current.saving).toBe('saved');
  await pass(120_000);
  wake.focus();
  await pass();
  expect(server.puts('sudoku')).toHaveLength(1);
  expect(server.requests.filter((r) => r.method === 'GET')).toHaveLength(1);

  server.answer = null;
  act(() => result.current.setState(game(2)));
  await pass();
  expect(server.saves.sudoku).toEqual(game(2));
  expect(result.current.refused).toBe(false);
});

test('the login tab: the waiting tab saves as soon as it loads, and it then takes that save', async () => {
  const server = fakeServer({ sudoku: game(1) });
  const waiting = await opened();
  server.answer = () => 401;
  act(() => waiting.result.current.setState(game(2)));
  await pass();
  expect(waiting.result.current.signedOut).toBe(true);

  // Logged in, in another tab: well inside the waiting tab's backoff.
  server.answer = null;
  server.requests.length = 0;
  const loginTab = renderHook(() => useSavedGame('sudoku'));
  await pass();

  expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
    'GET /api/save/sudoku', // the new tab loads, still the old game
    'PUT /api/save/sudoku', // which wakes the waiting tab
    'GET /api/save/sudoku', // whose save the new tab then takes
  ]);
  expect(waiting.result.current.signedOut).toBe(false);
  expect(loginTab.result.current.state).toEqual(game(2));
  expect(server.puts('sudoku')).toEqual([game(2)]);
});

test('a move in one tab reaches the other', async () => {
  const server = fakeServer({ sudoku: game(1) });
  const one = await opened();
  const two = await opened();
  act(() => one.result.current.setState(game(2)));
  await pass();
  expect(two.result.current.state).toEqual(game(2));
  expect(server.puts('sudoku')).toEqual([game(2)]);
});

test('flush waits for what is still going out', async () => {
  const server = fakeServer();
  const { result } = await opened();
  act(() => result.current.setState(game(1)));
  let sent;
  await act(async () => {
    sent = await result.current.flush();
  });
  expect(sent).toBe(true);
  expect(server.saves.sudoku).toEqual(game(1));
});

test('flush gives up after its time limit', async () => {
  const server = fakeServer();
  const { result } = await opened();
  server.answer = () => 503;
  act(() => result.current.setState(game(1)));
  let sent: boolean | undefined;
  void result.current.flush(3000).then((answer) => {
    sent = answer;
  });
  await pass(2900);
  expect(sent).toBeUndefined();
  await pass(200);
  expect(sent).toBe(false);
});

test('flush says no at once when the server has refused the save', async () => {
  const server = fakeServer();
  const { result } = await opened();
  server.answer = () => 413;
  act(() => result.current.setState(game(1)));
  await pass();
  await expect(result.current.flush()).resolves.toBe(false);
});

describe('offline, with the worker answering', () => {
  // A move, by the identity the rules keep: game(n) alone only moves the selection.
  const move = (n: number) => ({ ...game(n), history: [] });

  test('a fresh load with no network and nothing kept is not "no saved game"', async () => {
    const server = fakeServer({ sudoku: game(7) });
    server.worker = {};
    goOffline();
    const { result } = await opened();
    expect(result.current.ready).toBe(false);
    expect(result.current.state).toBeNull();
    expect(result.current.saving).toBe('offline');
    act(() => result.current.setState(move(1))); // nothing can replace the unseen save
    await pass(60_000);
    expect(server.puts('sudoku')).toEqual([]);

    server.worker = null;
    await act(async () => goOffline(false));
    await pass();
    expect(result.current.state).toEqual(game(7));
    expect(result.current.ready).toBe(true);
    expect(server.puts('sudoku')).toEqual([]);
  });

  test('a fresh load takes the kept save, says it is not saving, and writes nothing', async () => {
    const server = fakeServer();
    server.worker = { sudoku: game(7) };
    const { result } = await opened();
    expect(result.current.state).toEqual(game(7));
    expect(result.current.ready).toBe(true);
    expect(result.current.saving).toBe('offline');
    await pass(120_000);
    await act(async () => window.dispatchEvent(new Event('focus')));
    await pass(120_000);
    expect(server.puts('sudoku')).toEqual([]);
  });

  test('a kept "no save" is a real answer: no game, and nothing written', async () => {
    const server = fakeServer();
    server.worker = { sudoku: null };
    const { result } = await opened();
    expect(result.current.state).toBeNull();
    expect(result.current.ready).toBe(true);
    expect(result.current.unplayable).toBe(false);
    expect(server.puts('sudoku')).toEqual([]);
  });

  test('back online after a kept load with no moves, the server wins and nothing is written', async () => {
    const server = fakeServer({ sudoku: game(9) });
    server.worker = { sudoku: game(7) };
    goOffline();
    const { result } = await opened();
    expect(result.current.state).toEqual(game(7));

    server.worker = null;
    await act(async () => goOffline(false));
    await pass();
    expect(result.current.state).toEqual(game(9));
    expect(result.current.saving).toBe('saved');
    expect(server.puts('sudoku')).toEqual([]);
    expect(server.saves.sudoku).toEqual(game(9));
  });

  test('back online after a kept load with the same save, nothing is written and the marker clears', async () => {
    const server = fakeServer({ sudoku: game(7) });
    server.worker = { sudoku: game(7) };
    const { result } = await opened();
    server.worker = null;
    await act(async () => window.dispatchEvent(new Event('online')));
    await pass();
    expect(result.current.saving).toBe('saved');
    expect(server.puts('sudoku')).toEqual([]);
  });

  test('a real move after a kept load goes out when the connection returns: that move, once', async () => {
    const server = fakeServer({ sudoku: game(7) });
    server.worker = { sudoku: game(7) };
    goOffline();
    const { result } = await opened();
    act(() => result.current.setState(move(1)));
    await pass();
    expect(result.current.saving).toBe('offline');

    server.worker = null;
    await act(async () => goOffline(false));
    await pass();
    // Tries that failed while offline are seen too. Each is the move; none is the load.
    expect(server.puts('sudoku').length).toBeGreaterThan(0);
    for (const sent of server.puts('sudoku')) expect(sent).toEqual(move(1));
    expect(server.saves.sudoku).toEqual(move(1));
    expect(result.current.saving).toBe('saved');
  });

  test('a check answered from the cache never rolls back moves the server has', async () => {
    const server = fakeServer({ sudoku: game(1) });
    const { result } = await opened();
    act(() => result.current.setState(move(2)));
    await pass();
    expect(server.puts('sudoku')).toEqual([move(2)]);

    server.worker = { sudoku: game(1) }; // an older answer
    await act(async () => window.dispatchEvent(new Event('focus')));
    await pass();
    expect(result.current.state).toEqual(move(2));
    expect(result.current.saving).toBe('offline');
    expect(server.puts('sudoku')).toEqual([move(2)]);
  });

  test('when the first check after coming back fails, it tries again and the marker clears', async () => {
    const server = fakeServer({ sudoku: game(7) });
    server.worker = { sudoku: game(7) };
    const { result } = await opened();
    // The browser says online, and the first request still only reaches the cache.
    await act(async () => window.dispatchEvent(new Event('online')));
    await pass();
    expect(result.current.saving).toBe('offline');

    server.worker = null;
    await pass(30_000);
    expect(result.current.saving).toBe('saved');
    expect(server.puts('sudoku')).toEqual([]);

    const asked = server.requests.length;
    await pass(120_000); // a real answer ends the asking
    expect(server.requests.length).toBe(asked);
  });

  test('on a kept game, a move during a slow check lands at once and stands over newer server state', async () => {
    const server = fakeServer({ sudoku: game(9) });
    server.worker = { sudoku: game(7) };
    const { result } = await opened();

    server.worker = null;
    let answer = () => {};
    server.gate = new Promise<void>((resolve) => (answer = resolve));
    await act(async () => window.dispatchEvent(new Event('focus')));
    act(() => result.current.setState(move(1)));
    expect(result.current.state).toEqual(move(1)); // with the check still out

    server.gate = null;
    answer();
    await pass();
    expect(result.current.state).toEqual(move(1));
    expect(server.saves.sudoku).toEqual(move(1));
    expect(server.puts('sudoku')).toEqual([move(1)]);
    expect(result.current.saving).toBe('saved');
  });

  test('on a kept game, a check that fails drops no move, which saves later', async () => {
    const server = fakeServer({ sudoku: game(7) });
    server.worker = { sudoku: game(7) };
    const { result } = await opened();
    let answer = () => {};
    server.gate = new Promise<void>((resolve) => (answer = resolve));
    await act(async () => window.dispatchEvent(new Event('focus')));
    act(() => result.current.setState(move(1)));
    server.gate = null;
    server.worker = {};
    answer();
    await pass();
    expect(result.current.state).toEqual(move(1));

    server.worker = null;
    await pass(30_000);
    expect(server.saves.sudoku).toEqual(move(1));
  });

  test('a load from the cache does not tell the other tabs to try', async () => {
    const server = fakeServer({ sudoku: game(1) });
    const first = await opened();
    server.worker = { sudoku: game(1) };
    const before = server.requests.length;
    const second = await opened();
    await pass();
    // Only the second tab's own load: the first was not woken by it.
    expect(server.requests.length).toBe(before + 1);
    first.unmount();
    second.unmount();
  });
});
