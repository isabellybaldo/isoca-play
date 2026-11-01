import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import App from './App';
import { blanked, fakeServer } from './fakeServer.testutil';
import { LAYOUTS } from './mahjong/layouts';
import { newGame } from './mahjong/rules';
import { newSudoku } from './sudoku/rules';

// A save can pass every check and still not draw; this stands in for whatever that is.
vi.mock('./mahjong/MahjongGame', () => ({
  default: () => {
    throw new Error('does not draw');
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

test('a game that will not draw shows a note, keeps New game, and leaves the other game alone', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const trophy = LAYOUTS.find((l) => l.id === 'trophy')!;
  const dealt = newGame(trophy.cells.map((c, id) => ({ id, ...c, face: 'cat' })));
  const saved = { ...dealt, history: [{ onBoard: dealt.onBoard, slots: [] }] };
  const server = fakeServer({
    mahjong: { layout: 'trophy', state: saved },
    sudoku: newSudoku(blanked('easy', [0, 1, 2])),
  });
  const user = userEvent.setup();
  render(<App />);
  await settle();

  await user.click(screen.getByRole('button', { name: /Mahjong/ }));
  await user.click(screen.getByRole('button', { name: 'Resume Trophy, 1 move' }));
  expect(screen.getByText('This game could not be opened.')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'New game' }));
  // Back on the setup screen, with no way into the broken game, and the save untouched.
  expect(screen.queryByRole('button', { name: /^Resume/ })).toBeNull();
  expect(screen.getByText('The saved game could not be opened.')).toBeTruthy();
  expect(server.puts('mahjong')).toEqual([]);

  // Replacing it still asks.
  await user.click(screen.getByRole('button', { name: /^Trophy/ }));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Keep playing' }));

  await user.click(screen.getByRole('button', { name: 'Back to home' }));
  await user.click(screen.getByRole('button', { name: /Sudoku/ }));
  expect(screen.getByRole('button', { name: 'Resume Easy, 0 moves' })).toBeTruthy();
});
