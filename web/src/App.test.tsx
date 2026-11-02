import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { goToLogin } from './api';
import App from './App';
import { blanked, fakeServer, goOffline } from './fakeServer.testutil';
import { newSudoku } from './sudoku/rules';
import { newGame } from './mahjong/rules';
import { LAYOUTS } from './mahjong/layouts';
import * as offline from './offline';

// A real navigation is the one thing jsdom cannot do.
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  goToLogin: vi.fn(),
}));

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  server = fakeServer();
  vi.mocked(goToLogin).mockClear();
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function open() {
  const view = render(<App />);
  await settle();
  return view;
}

test('home opens each game and comes back', async () => {
  const user = userEvent.setup();
  await open();

  for (const game of ['Mahjong', 'Sudoku']) {
    await user.click(screen.getByRole('button', { name: new RegExp(game) }));
    expect(screen.getByRole('heading', { name: game })).toBeTruthy();
    // The other game's card is gone: this is a different screen, not an overlay.
    expect(screen.queryByRole('heading', { name: 'isoca play' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(screen.getByRole('heading', { name: 'isoca play' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to home' })).toBeNull();
  }
});

test('mahjong goes from setup to a real deal and back, keeping the level', async () => {
  const user = userEvent.setup();
  await open();
  await user.click(screen.getByRole('button', { name: /Mahjong/ }));

  await user.click(screen.getByRole('button', { name: 'Medium' }));
  await user.click(screen.getByRole('button', { name: /^Trophy/ }));
  const board = await screen.findByRole('group', { name: 'Board' });
  expect(within(board).getAllByRole('button')).toHaveLength(62);
  expect(within(board).getAllByRole('button', { name: 'Face-down tile' }).length).toBeGreaterThan(0);

  await user.click(screen.getByRole('button', { name: 'Back to setup' }));
  expect(screen.getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')).toBe('true');

  await user.click(screen.getByRole('button', { name: 'Back to home' }));
  expect(screen.getByRole('heading', { name: 'isoca play' })).toBeTruthy();
});

test('home has the two games and a log out button', async () => {
  await open();
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
    expect.stringContaining('Mahjong'),
    expect.stringContaining('Sudoku'),
    'Log out',
  ]);
});

test('the home cards show tile art', async () => {
  await open();
  const mahjong = screen.getByRole('button', { name: /Mahjong/ });
  expect(mahjong.querySelectorAll('svg').length).toBeGreaterThan(0);
  const sudoku = screen.getByRole('button', { name: /Sudoku/ });
  expect(sudoku.querySelectorAll('svg').length).toBeGreaterThan(0);
});

describe('back keeps the game', () => {
  // Every element with its attributes and text. Attributes are sorted, as React
  // sets them in another order on a tile that was updated than on a fresh one.
  const look = () =>
    [...screen.getByRole('main').querySelectorAll('*')].map((el) => {
      const attrs = [...el.attributes].map((a) => `${a.name}=${a.value}`).sort();
      return [el.tagName, ...attrs, el.children.length === 0 ? el.textContent : ''].join(' ');
    });
  const board = () => screen.getByRole('group', { name: 'Board' });
  const freeTiles = () =>
    within(board())
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-disabled') === 'false');

  test('mahjong resumes exactly, with its shape, moves, selection and level', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Medium' }));
    await user.click(screen.getByRole('button', { name: /^Trophy/ }));
    await screen.findByRole('group', { name: 'Board' });
    await user.dblClick(freeTiles()[0]);
    await user.click(freeTiles()[0]); // selected, left in the air
    expect(screen.getByText('Moves: 1')).toBeTruthy();
    const before = look();

    await user.click(screen.getByRole('button', { name: 'Back to setup' }));
    await user.click(screen.getByRole('button', { name: 'Hard' })); // only looking
    await user.click(screen.getByRole('button', { name: 'Back to home' }));
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    await user.click(screen.getByRole('button', { name: 'Resume Trophy, 1 move' }));
    expect(look()).toEqual(before);

    await user.click(screen.getByRole('button', { name: 'Back to setup' }));
    expect(screen.getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('Slots off starts a no-slots game, is remembered, and Resume says so', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    expect(screen.getByRole('button', { name: 'Slots' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Slots' }));
    expect(localStorage.getItem('isoca-play-mahjong-slots')).toBe('off');
    await user.click(screen.getByRole('button', { name: /^Frame/ }));
    await screen.findByRole('group', { name: 'Board' });
    expect(screen.queryByRole('list', { name: 'Slots' })).toBeNull();
    await user.dblClick(freeTiles()[0]);
    await user.click(screen.getByRole('button', { name: 'Back to setup' }));
    expect(screen.getByRole('button', { name: /^Resume Frame, no slots, \d+ moves?$/ })).toBeTruthy();
    // The switch only affects the next start.
    await user.click(screen.getByRole('button', { name: 'Slots' }));
    await user.click(screen.getByRole('button', { name: /^Resume Frame, no slots/ }));
    expect(screen.queryByRole('list', { name: 'Slots' })).toBeNull();
  });

  test('the Slots choice survives a remount, and a broken store falls back to on', async () => {
    const user = userEvent.setup();
    const first = await open();
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    await user.click(screen.getByRole('button', { name: 'Slots' }));
    first.unmount();
    await open();
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    expect(screen.getByRole('button', { name: 'Slots' }).getAttribute('aria-pressed')).toBe('false');
    cleanup();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    await open();
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    expect(screen.getByRole('button', { name: 'Slots' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Slots' }));
    expect(screen.getByRole('button', { name: 'Slots' }).getAttribute('aria-pressed')).toBe('false');
  });

  test('mahjong: another shape asks before dropping a game with moves', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    await user.click(screen.getByRole('button', { name: /^Frame/ }));
    await screen.findByRole('group', { name: 'Board' });
    await user.dblClick(freeTiles()[0]);
    await user.click(screen.getByRole('button', { name: 'Back to setup' }));

    await user.click(screen.getByRole('button', { name: /^Frame/ }));
    await user.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.getByRole('group', { name: 'Board' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to setup' }));

    // Looking at another level, a shape there asks too, and Keep playing leads back to the held game's level.
    const held = screen.getByRole('button', { name: 'Resume Frame, 1 move' });
    expect(held).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Hard' }));
    await user.click(screen.getByRole('button', { name: /^Fort/ }));
    await user.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.getByRole('group', { name: 'Board' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to setup' }));
    expect(screen.getByRole('button', { name: 'Hard' }).getAttribute('aria-pressed')).toBe('false');

    await user.click(screen.getByRole('button', { name: /^Frame/ }));
    await user.click(screen.getByRole('button', { name: 'Start new game' }));
    expect(await screen.findByText('Moves: 0')).toBeTruthy();

    // No moves yet, so nothing to lose and no question.
    await user.click(screen.getByRole('button', { name: 'Back to setup' }));
    await user.click(screen.getByRole('button', { name: 'Hard' }));
    await user.click(screen.getByRole('button', { name: /^Fort/ }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await screen.findByText('Moves: 0')).toBeTruthy();
  });

  test('sudoku resumes exactly, with its numbers, notes, mode and level', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Hard' }));
    await screen.findByRole('group', { name: 'Board' });
    const empty = () => within(board()).getAllByRole('button', { name: /empty$/ });
    const pad = (d: string) => within(screen.getByRole('group', { name: 'Numbers' })).getByRole('button', { name: d });
    await user.click(empty()[0]);
    await user.click(pad('5'));
    await user.click(empty()[0]);
    await user.click(screen.getByRole('button', { name: 'Notes' }));
    await user.click(pad('3'));
    const before = look();

    await user.click(screen.getByRole('button', { name: 'Back to levels' }));
    await user.click(screen.getByRole('button', { name: 'Back to home' }));
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    await user.click(screen.getByRole('button', { name: 'Resume Hard, 2 moves' }));
    expect(look()).toEqual(before);
  });

  test('sudoku: a level asks before dropping a game with moves', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    await screen.findByRole('group', { name: 'Board' });
    const held = look();
    await user.click(within(board()).getAllByRole('button', { name: /empty$/ })[0]);
    await user.click(within(screen.getByRole('group', { name: 'Numbers' })).getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: 'Back to levels' }));

    await user.click(screen.getByRole('button', { name: 'Medium' }));
    await user.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.getByRole('group', { name: 'Board' })).toBeTruthy();
    expect(look()).not.toEqual(held);

    await user.click(screen.getByRole('button', { name: 'Back to levels' }));
    await user.click(screen.getByRole('button', { name: 'Medium' }));
    await user.click(screen.getByRole('button', { name: 'Start new game' }));
    expect(await screen.findByText('Medium')).toBeTruthy();
  });
});

describe('the server', () => {
  const trophy = LAYOUTS.find((l) => l.id === 'trophy')!;
  const dealt = newGame(trophy.cells.map((c, id) => ({ id, ...c, face: 'cat' })));
  const played = { ...dealt, onBoard: dealt.onBoard.slice(1), history: [{ onBoard: dealt.onBoard, slots: [] }] };

  test('opening the app resumes the saved games', async () => {
    const user = userEvent.setup();
    server.saves.mahjong = { layout: 'trophy', state: played };
    server.saves.sudoku = newSudokuSave();
    await open();
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    await user.click(screen.getByRole('button', { name: 'Resume Trophy, 1 move' }));
    expect(within(screen.getByRole('group', { name: 'Board' })).getAllByRole('button')).toHaveLength(61);
    expect(screen.getByText('Moves: 1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to setup' }));
    await user.click(screen.getByRole('button', { name: 'Back to home' }));
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    await user.click(screen.getByRole('button', { name: 'Resume Easy, 0 moves' }));
    expect(within(screen.getByRole('group', { name: 'Board' })).getAllByRole('button')).toHaveLength(81);
    expect(server.requests.filter((r) => r.method === 'PUT')).toEqual([]);
  });

  test('a saved game asks before a new game replaces it', async () => {
    const user = userEvent.setup();
    server.saves.mahjong = { layout: 'trophy', state: played };
    await open();
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    await user.click(screen.getByRole('button', { name: /^Frame/ }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(server.requests.some((r) => r.path === '/api/new/mahjong')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Start new game' }));
    expect(await screen.findByText('Moves: 0')).toBeTruthy();
    expect(server.requests.find((r) => r.path === '/api/new/mahjong')!.body).toEqual({ layout: 'frame' });
  });

  test('a mahjong save holds the layout id and the state', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    await user.click(screen.getByRole('button', { name: /^Frame/ }));
    await screen.findByRole('group', { name: 'Board' });
    await settle();
    const saved = server.saves.mahjong as { layout: string; state: { tiles: unknown[]; history: unknown[] } };
    expect(saved.layout).toBe('frame');
    expect(saved.state.tiles.length).toBeGreaterThan(0);
    expect(saved.state.history).toEqual([]);
  });

  test('a sudoku save holds the state, and a new game names the board on screen', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    await screen.findByRole('group', { name: 'Board' });
    await settle();
    const saved = server.saves.sudoku as { puzzle: { givens: string; solution: string; level: string } };
    expect(saved.puzzle.level).toBe('easy');
    expect(saved.puzzle.solution).toHaveLength(81);

    await user.click(screen.getByRole('button', { name: 'New game' }));
    await settle();
    const asked = server.requests.filter((r) => r.path === '/api/new/sudoku').at(-1)!;
    expect(asked.body).toEqual({ level: 'easy', not: saved.puzzle.givens });
  });

  test('a device opening later shows the latest save', async () => {
    const user = userEvent.setup();
    const first = await open();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    await user.click(screen.getByRole('button', { name: 'Hard' }));
    await screen.findByRole('group', { name: 'Board' });
    const board = () => screen.getByRole('group', { name: 'Board' });
    await user.click(within(board()).getAllByRole('button', { name: /empty$/ })[0]);
    await user.click(within(screen.getByRole('group', { name: 'Numbers' })).getByRole('button', { name: '5' }));
    await settle();
    first.unmount();

    await open();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    await user.click(screen.getByRole('button', { name: 'Resume Hard, 1 move' }));
    expect(within(board()).getAllByRole('button', { name: /written 5$/ })).toHaveLength(1);
  });

  test('a 401 shows the marker and a link to log in, and keeps the game in memory', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    const board = await screen.findByRole('group', { name: 'Board' });
    await settle();

    server.answer = ({ method }) => (method === 'PUT' ? 401 : undefined);
    const square = within(board).getAllByRole('button', { name: /empty$/ })[0];
    await user.click(square);
    await user.click(within(screen.getByRole('group', { name: 'Numbers' })).getByRole('button', { name: '5' }));
    await settle();
    const link = screen.getByRole('link', { name: 'Log in' });
    expect(link.getAttribute('href')).toBe('/login');
    // A new tab, so this page and its unsaved game stay where they are.
    expect(link.getAttribute('target')).toBe('_blank');
    expect(square.getAttribute('aria-pressed')).toBe('true');
  });

  test('the marker says nothing when saved, and nothing about whether a sudoku is right', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    await screen.findByRole('group', { name: 'Board' });
    await settle();
    expect(container.querySelector('.save-marker')).toBeNull();

    server.answer = ({ method }) => (method === 'PUT' ? 503 : undefined);
    await user.click(within(screen.getByRole('group', { name: 'Board' })).getAllByRole('button', { name: /empty$/ })[0]);
    await user.click(within(screen.getByRole('group', { name: 'Numbers' })).getByRole('button', { name: '5' }));
    await settle();
    const said = container.querySelector('.save-marker')!.textContent!;
    expect(said).toMatch(/not saved/i);
    expect(said).not.toMatch(/wrong|right|correct|mistake|solved/i);
  });

  test('new game is disabled offline with a short note', async () => {
    const user = userEvent.setup();
    server.saves.mahjong = { layout: 'trophy', state: dealt };
    await open();
    goOffline();
    await settle();

    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    const frame = screen.getByRole('button', { name: /^Frame/ }) as HTMLButtonElement;
    expect(frame.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Random' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('New games need a connection.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^Resume Trophy/ }));
    expect((screen.getByRole('button', { name: 'New game' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('New games need a connection.')).toBeTruthy();
    expect(server.requests.some((r) => r.path === '/api/new/mahjong')).toBe(false);
  });

  test('sudoku too: levels and new game are disabled offline, with the note', async () => {
    const user = userEvent.setup();
    server.saves.sudoku = newSudokuSave();
    await open();
    goOffline();
    await settle();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    expect((screen.getByRole('button', { name: 'Hard' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('New games need a connection.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Resume Easy/ }));
    expect((screen.getByRole('button', { name: 'New game' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('New games need a connection.')).toBeTruthy();
  });

  test('a new game that fails says so and leaves the held game alone', async () => {
    const user = userEvent.setup();
    server.saves.mahjong = { layout: 'trophy', state: played };
    await open();
    server.answer = ({ path }) => (path === '/api/new/mahjong' ? 503 : undefined);
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    await user.click(screen.getByRole('button', { name: /^Frame/ }));
    await user.click(screen.getByRole('button', { name: 'Start new game' }));
    expect(await screen.findByText('That did not work. Try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume Trophy, 1 move' })).toBeTruthy();
  });

  test('starting waits for the load, so a new game cannot pass over a saved one', async () => {
    const user = userEvent.setup();
    server.answer = ({ method }) => (method === 'GET' ? 503 : undefined);
    await open();
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    expect((screen.getByRole('button', { name: /^Frame/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Loading your saved game.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to home' }));
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    expect((screen.getByRole('button', { name: 'Easy' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('home has a log out button that posts /logout', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await settle();
    expect(server.requests.at(-1)).toMatchObject({ method: 'POST', path: '/logout' });
    expect(goToLogin).toHaveBeenCalledOnce();
  });

  test('log out sends the last move first', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    await screen.findByRole('group', { name: 'Board' });
    await user.click(screen.getByRole('button', { name: 'Back to levels' }));
    await user.click(screen.getByRole('button', { name: 'Back to home' }));
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await settle();
    const paths = server.requests.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('POST /logout');
    expect(paths.lastIndexOf('PUT /api/save/sudoku')).toBeLessThan(paths.indexOf('POST /logout'));
  });

  test('log out with a move not sent asks one confirming tap', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    server.answer = ({ method }) => (method === 'PUT' ? 413 : undefined);
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    await screen.findByRole('group', { name: 'Board' });
    await settle();
    await user.click(screen.getByRole('button', { name: 'Back to levels' }));
    await user.click(screen.getByRole('button', { name: 'Back to home' }));

    await user.click(screen.getByRole('button', { name: 'Log out' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(server.requests.some((r) => r.path === '/logout')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(goToLogin).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Log out' }));
    await settle();
    expect(server.requests.at(-1)).toMatchObject({ method: 'POST', path: '/logout' });
    expect(goToLogin).toHaveBeenCalledOnce();
  });

  test('a permanent refusal has its own marker', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    server.answer = ({ method }) => (method === 'PUT' ? 413 : undefined);
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    await screen.findByRole('group', { name: 'Board' });
    await settle();
    expect(container.querySelector('.save-marker')!.textContent).toBe('Not saved: the server refused this.');
  });

  test.each([
    ['sudoku', 'Sudoku', 'Easy'],
    ['mahjong', 'Mahjong', 'Random'],
  ])('a %s save that cannot be opened is not resumed, says so, and asks before it is replaced', async (game, card, start) => {
    const user = userEvent.setup();
    server.saves[game] = { puzzle: { givens: 'x', solution: 'y' }, values: [], notes: [], history: [] };
    await open();
    await user.click(screen.getByRole('button', { name: new RegExp(card) }));
    expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull();
    expect(screen.getByText('The saved game could not be opened.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: start }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('could not be opened');
    expect(server.puts(game)).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Start new game' }));
    await screen.findByRole('group', { name: 'Board' });
    await settle();
    expect(server.puts(game)).toHaveLength(1);
    expect(screen.queryByText('The saved game could not be opened.')).toBeNull();
  });

  test('log out offline is disabled with a short note, and clears nothing', async () => {
    const clear = vi.spyOn(offline, 'clearDevice');
    await open();
    goOffline();
    await settle();
    expect((screen.getByRole('button', { name: 'Log out' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Logging out needs a connection.')).toBeTruthy();
    expect(server.requests.some((r) => r.path === '/logout')).toBe(false);
    expect(goToLogin).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();

    await act(async () => goOffline(false));
    await settle();
    expect((screen.getByRole('button', { name: 'Log out' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('Logging out needs a connection.')).toBeNull();
  });

  test('log out ends the session, then clears the device, then goes to login', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    vi.spyOn(offline, 'clearDevice').mockImplementation(async () => {
      order.push(`clear after ${server.requests.at(-1)?.path}`);
    });
    vi.mocked(goToLogin).mockImplementation(() => void order.push('login'));
    await open();
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await settle();
    expect(order).toEqual(['clear after /logout', 'login']);
  });

  test('a log out the server did not take leaves the device as it is', async () => {
    const user = userEvent.setup();
    const clear = vi.spyOn(offline, 'clearDevice');
    await open();
    server.answer = ({ path }) => (path === '/logout' ? 503 : undefined);
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await settle();
    expect(clear).not.toHaveBeenCalled();
    expect(goToLogin).not.toHaveBeenCalled();
  });

  test('a slow log out clears the device without waiting, then goes to login', async () => {
    const user = userEvent.setup();
    const clear = vi.spyOn(offline, 'clearDevice');
    await open();
    let answer = () => {};
    server.gate = new Promise<void>((resolve) => (answer = resolve));
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3200));
    });
    expect(clear).toHaveBeenCalledOnce();
    expect(goToLogin).not.toHaveBeenCalled();
    answer();
    await settle();
    await settle();
    expect(clear).toHaveBeenCalledOnce();
    expect(goToLogin).toHaveBeenCalledOnce();
  }, 10_000);

  test('a log out that never answers does not claim failure: the device is clear, and login says where it stands', async () => {
    const user = userEvent.setup();
    const clear = vi.spyOn(offline, 'clearDevice');
    await open();
    let abort = (_: Error) => {};
    server.gate = new Promise<void>((_resolve, reject) => (abort = reject));
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3200));
    });
    abort(new DOMException('Aborted', 'AbortError'));
    await settle();
    await settle();
    expect(clear).toHaveBeenCalledOnce();
    expect(goToLogin).toHaveBeenCalledOnce();
    expect(screen.queryByText('That did not work. Try again.')).toBeNull();
  }, 10_000);

  test('a clearing that hangs does not hold up the log out', async () => {
    const user = userEvent.setup();
    vi.spyOn(offline, 'clearDevice').mockImplementation(() => new Promise(() => {}));
    await open();
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3200));
    });
    expect(goToLogin).toHaveBeenCalledOnce();
  }, 10_000);

  describe('a log out whose outcome was not confirmed', () => {
    const NOTE = 'Log out could not be confirmed, you are still signed in.';
    const FLAG = 'isoca-play-logout-unconfirmed';
    const past3s = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 3200));
      });
    // Past goToLogin the real browser loads the app again if the session is still alive.
    const bootAgain = async () => {
      cleanup();
      server.gate = null;
      server.answer = null;
      await open();
    };

    test('a 5xx after 3 seconds says so on the next boot, once', async () => {
      const user = userEvent.setup();
      await open();
      let answer = () => {};
      server.gate = new Promise<void>((resolve) => (answer = resolve));
      server.answer = ({ path }) => (path === '/logout' ? 500 : undefined);
      await user.click(screen.getByRole('button', { name: 'Log out' }));
      await past3s();
      answer();
      await settle();
      await settle();
      expect(goToLogin).toHaveBeenCalledOnce();
      expect(screen.queryByText(NOTE)).toBeNull();

      await bootAgain();
      expect(screen.getByText(NOTE)).toBeTruthy();

      await bootAgain();
      expect(screen.queryByText(NOTE)).toBeNull();
    }, 10_000);

    test('no answer at all says so too, even if the page goes before the request ends', async () => {
      const user = userEvent.setup();
      await open();
      server.gate = new Promise<void>(() => {});
      await user.click(screen.getByRole('button', { name: 'Log out' }));
      await past3s();
      await bootAgain();
      expect(screen.getByText(NOTE)).toBeTruthy();
    }, 10_000);

    test('a slow log out the server confirmed says nothing', async () => {
      const user = userEvent.setup();
      await open();
      let answer = () => {};
      server.gate = new Promise<void>((resolve) => (answer = resolve));
      await user.click(screen.getByRole('button', { name: 'Log out' }));
      await past3s();
      answer();
      await settle();
      await settle();
      expect(goToLogin).toHaveBeenCalledOnce();
      expect(sessionStorage.getItem(FLAG)).toBeNull();
      await bootAgain();
      expect(screen.queryByText(NOTE)).toBeNull();
    }, 10_000);

    test('a quick refusal keeps its own note, and leaves nothing for the next boot', async () => {
      const user = userEvent.setup();
      await open();
      server.answer = ({ path }) => (path === '/logout' ? 503 : undefined);
      await user.click(screen.getByRole('button', { name: 'Log out' }));
      await settle();
      expect(screen.getByText('That did not work. Try again.')).toBeTruthy();
      await bootAgain();
      expect(screen.queryByText(NOTE)).toBeNull();
    });

    test('a fresh login is not told it failed to log out, and its mark leaves the address', async () => {
      sessionStorage.setItem(FLAG, '1');
      window.history.replaceState(null, '', '/#logged-in');
      await open();
      expect(screen.queryByText(NOTE)).toBeNull();
      expect(sessionStorage.getItem(FLAG)).toBeNull();
      expect(window.location.hash).toBe('');
    });

    test('the server marks a login with what the page looks for', () => {
      const auth = readFileSync(join(import.meta.dirname, '..', '..', 'server', 'isoca_play', 'auth.py'), 'utf8');
      expect(auth).toContain('RedirectResponse("/#logged-in", 303');
    });

    test('a boot that finds the session gone says nothing, and forgets', async () => {
      sessionStorage.setItem(FLAG, '1');
      server.answer = ({ path }) => (path.startsWith('/api/save/') ? 401 : undefined);
      await open();
      expect(screen.queryByText(NOTE)).toBeNull();
      expect(sessionStorage.getItem(FLAG)).toBeNull();
    });

    test('a boot answered only from the device does not claim a session, and keeps the flag for later', async () => {
      sessionStorage.setItem(FLAG, '1');
      server.worker = { sudoku: null, mahjong: null, solitaire: null };
      await open();
      expect(screen.queryByText(NOTE)).toBeNull();
      expect(sessionStorage.getItem(FLAG)).toBe('1');

      cleanup();
      server.worker = null;
      await open();
      expect(screen.getByText(NOTE)).toBeTruthy();
    });

    test('where the browser refuses session storage, log out still works', async () => {
      const user = userEvent.setup();
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied');
      });
      await open();
      server.gate = new Promise<void>((_resolve, reject) =>
        setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 3100),
      );
      await user.click(screen.getByRole('button', { name: 'Log out' }));
      await past3s();
      await settle();
      expect(goToLogin).toHaveBeenCalledOnce();
    }, 10_000);
  });

  describe('home while a log out runs', () => {
    const controls = () =>
      ['Log out', /Mahjong/, /Sudoku/].map((name) => screen.getByRole('button', { name }) as HTMLButtonElement);

    test('every control is disabled, and stays so on the way to login', async () => {
      const user = userEvent.setup();
      await open();
      let answer = () => {};
      server.gate = new Promise<void>((resolve) => (answer = resolve));
      await user.click(screen.getByRole('button', { name: 'Log out' }));
      await settle();
      expect(controls().map((b) => b.disabled)).toEqual([true, true, true]);
      answer();
      await settle();
      await settle();
      expect(goToLogin).toHaveBeenCalledOnce();
      expect(controls().map((b) => b.disabled)).toEqual([true, true, true]);
    });

    test('a second tap starts no second log out', async () => {
      const user = userEvent.setup();
      await open();
      let answer = () => {};
      server.gate = new Promise<void>((resolve) => (answer = resolve));
      await user.click(screen.getByRole('button', { name: 'Log out' }));
      await settle();
      await user.click(screen.getByRole('button', { name: 'Log out' }));
      await user.click(screen.getByRole('button', { name: /Sudoku/ }));
      answer();
      await settle();
      await settle();
      expect(server.requests.filter((r) => r.path === '/logout')).toHaveLength(1);
      expect(screen.getByRole('heading', { name: 'isoca play' })).toBeTruthy();
    });

    test('a quick refusal hands the controls back', async () => {
      const user = userEvent.setup();
      await open();
      server.answer = ({ path }) => (path === '/logout' ? 503 : undefined);
      await user.click(screen.getByRole('button', { name: 'Log out' }));
      await settle();
      expect(controls().map((b) => b.disabled)).toEqual([false, false, false]);
    });

    test('the unsaved-moves question hands the controls back behind it, and Stay leaves them live', async () => {
      const user = userEvent.setup();
      await open();
      await user.click(screen.getByRole('button', { name: /Sudoku/ }));
      server.answer = ({ method }) => (method === 'PUT' ? 413 : undefined);
      await user.click(screen.getByRole('button', { name: 'Easy' }));
      await screen.findByRole('group', { name: 'Board' });
      await settle();
      await user.click(screen.getByRole('button', { name: 'Back to levels' }));
      await user.click(screen.getByRole('button', { name: 'Back to home' }));
      await user.click(screen.getByRole('button', { name: 'Log out' }));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Stay' }));
      expect(controls().map((b) => b.disabled)).toEqual([false, false, false]);
    });
  });

  test('offline the marker shows with nothing waiting', async () => {
    const { container } = await open();
    goOffline();
    await settle();
    expect(container.querySelector('.save-marker')!.textContent).toBe('Offline, not saved yet.');

    await act(async () => goOffline(false));
    await settle();
    expect(container.querySelector('.save-marker')).toBeNull();
  });

  test('a page told it is signed out offers no log in while offline', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    server.answer = ({ method }) => (method === 'PUT' ? 401 : undefined);
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    await screen.findByRole('group', { name: 'Board' });
    await settle();
    expect(container.querySelector('.save-marker a')).toBeTruthy();

    goOffline();
    await settle();
    expect(container.querySelector('.save-marker a')).toBeNull();
    expect(container.querySelector('.save-marker')!.textContent).toBe('Offline, not saved yet.');
  });

  test('a load answered from the cache shows the marker, even if the browser says online', async () => {
    server.worker = { sudoku: null, mahjong: null, solitaire: null };
    const { container } = await open();
    expect(container.querySelector('.save-marker')!.textContent).toBe('Offline, not saved yet.');
    expect(server.requests.some((r) => r.method === 'PUT')).toBe(false);
  });
});

function newSudokuSave() {
  return newSudoku(blanked('easy', [0, 1, 2]));
}
