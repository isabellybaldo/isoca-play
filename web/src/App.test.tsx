import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import App from './App';

afterEach(cleanup);

test('home opens each game and comes back', async () => {
  const user = userEvent.setup();
  render(<App />);

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
  render(<App />);
  await user.click(screen.getByRole('button', { name: /Mahjong/ }));

  await user.click(screen.getByRole('button', { name: 'Medium' }));
  await user.click(screen.getByRole('button', { name: /^Trophy/ }));
  const board = screen.getByRole('group', { name: 'Board' });
  expect(within(board).getAllByRole('button')).toHaveLength(62);
  expect(within(board).getAllByRole('button', { name: 'Face-down tile' }).length).toBeGreaterThan(0);

  await user.click(screen.getByRole('button', { name: 'Back to setup' }));
  expect(screen.getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')).toBe('true');

  await user.click(screen.getByRole('button', { name: 'Back to home' }));
  expect(screen.getByRole('heading', { name: 'isoca play' })).toBeTruthy();
});

test('home has no login or saved-game controls yet', () => {
  render(<App />);
  expect(screen.getAllByRole('button')).toHaveLength(2);
});

test('the home cards show tile art', () => {
  render(<App />);
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
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Medium' }));
    await user.click(screen.getByRole('button', { name: /^Trophy/ }));
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

  test('mahjong: another shape asks before dropping a game with moves', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Mahjong/ }));
    await user.click(screen.getByRole('button', { name: /^Frame/ }));
    await user.dblClick(freeTiles()[0]);
    await user.click(screen.getByRole('button', { name: 'Back to setup' }));

    await user.click(screen.getByRole('button', { name: /^Frame/ }));
    await user.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.getByRole('button', { name: 'Resume Frame, 1 move' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^Frame/ }));
    await user.click(screen.getByRole('button', { name: 'Start new game' }));
    expect(screen.getByText('Moves: 0')).toBeTruthy();

    // No moves yet, so nothing to lose and no question.
    await user.click(screen.getByRole('button', { name: 'Back to setup' }));
    await user.click(screen.getByRole('button', { name: 'Hard' }));
    await user.click(screen.getByRole('button', { name: /^Fort/ }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Moves: 0')).toBeTruthy();
  });

  test('sudoku resumes exactly, with its numbers, notes, mode and level', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Hard' }));
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
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Sudoku/ }));
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    const held = look();
    await user.click(within(board()).getAllByRole('button', { name: /empty$/ })[0]);
    await user.click(within(screen.getByRole('group', { name: 'Numbers' })).getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: 'Back to levels' }));

    await user.click(screen.getByRole('button', { name: 'Medium' }));
    await user.click(screen.getByRole('button', { name: 'Keep playing' }));
    await user.click(screen.getByRole('button', { name: 'Resume Easy, 1 move' }));
    expect(look()).not.toEqual(held);

    await user.click(screen.getByRole('button', { name: 'Back to levels' }));
    await user.click(screen.getByRole('button', { name: 'Medium' }));
    await user.click(screen.getByRole('button', { name: 'Start new game' }));
    expect(screen.getByText('Medium')).toBeTruthy();
  });
});
