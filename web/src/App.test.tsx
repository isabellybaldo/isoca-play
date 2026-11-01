import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
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
  expect(within(board).getAllByRole('button')).toHaveLength(58);
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
