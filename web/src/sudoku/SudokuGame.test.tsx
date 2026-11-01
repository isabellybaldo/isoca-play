import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PUZZLES } from './puzzles';
import type { Puzzle } from './rules';
import SudokuGame from './SudokuGame';

// Three small puzzles: the real first easy solution with three squares blanked.
vi.mock('./puzzles', async (importOriginal) => {
  const real = await importOriginal<typeof import('./puzzles')>();
  const solution = real.PUZZLES.find((p) => p.level === 'easy')!.solution;
  const blank = (level: Puzzle['level'], cells: number[]): Puzzle => ({
    level,
    solution,
    givens: [...solution].map((ch, i) => (cells.includes(i) ? '.' : ch)).join(''),
  });
  return { ...real, PUZZLES: [blank('easy', [0, 1, 2]), blank('easy', [40, 41, 42]), blank('hard', [78, 79, 80])] };
});

const SOLUTION = [...PUZZLES[0].solution].map(Number);
const FIRST_BLANKS = [0, 1, 2];
const SECOND_BLANKS = [40, 41, 42];
const wrongDigit = (cell: number) => (SOLUTION[cell] % 9) + 1;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function start(level = 'Easy') {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const onBack = vi.fn();
  render(<SudokuGame onBack={onBack} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: level }));
  return { user, onBack };
}

const cells = () => within(screen.getByRole('group', { name: 'Board' })).getAllByRole('button');
const pad = (digit: number) =>
  within(screen.getByRole('group', { name: 'Numbers' })).getByRole('button', { name: String(digit) });
const mode = (name: 'Write' | 'Notes') => screen.getByRole('button', { name });
const note = () => screen.getByRole('status').textContent;
const valueOf = (cell: number) => cells()[cell].querySelector('.value')?.textContent;

type User = ReturnType<typeof userEvent.setup>;

async function writeIn(user: User, cell: number, digit: number) {
  await user.click(mode('Write'));
  await user.click(cells()[cell]);
  await user.click(pad(digit));
}

async function fill(user: User, blanks: number[], digit: (cell: number) => number) {
  for (const cell of blanks) await writeIn(user, cell, digit(cell));
}

describe('level choice', () => {
  test('starts with the three levels, and back leaves', async () => {
    const onBack = vi.fn();
    render(<SudokuGame onBack={onBack} />);
    expect(screen.getByRole('heading', { name: 'Sudoku' })).toBeTruthy();
    for (const level of ['Easy', 'Medium', 'Hard']) expect(screen.getByRole('button', { name: level })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Board' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to home' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  test('a level opens a 9 by 9 board of a puzzle of that level', async () => {
    await start('Hard');
    expect(cells()).toHaveLength(81);
    expect(cells()[80].getAttribute('aria-label')).toMatch(/empty/);
    expect(cells()[0].getAttribute('aria-label')).toMatch(/given/);
  });

  test('back from the board returns to the level choice', async () => {
    const { user } = await start();
    await user.click(screen.getByRole('button', { name: 'Back to levels' }));
    expect(screen.getByRole('button', { name: 'Medium' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Board' })).toBeNull();
  });
});

describe('writing and notes', () => {
  test('notes mode shows small numbers; write mode replaces them with one big one', async () => {
    const { user } = await start();
    await user.click(mode('Notes'));
    await user.click(cells()[0]);
    for (const d of [1, 2, 3]) await user.click(pad(d));
    expect(cells()[0].querySelectorAll('.note-on')).toHaveLength(3);
    expect(valueOf(0)).toBeUndefined();

    await user.click(pad(2)); // again takes it away
    expect([...cells()[0].querySelectorAll('.note-on')].map((n) => n.textContent)).toEqual(['1', '3']);

    await user.click(mode('Write'));
    await user.click(pad(7));
    expect(valueOf(0)).toBe('7');
    expect(cells()[0].querySelector('.notes')).toBeNull();
  });

  test('the notes grid has nine fixed places, so a note keeps its spot', async () => {
    const { user } = await start();
    await user.click(mode('Notes'));
    await user.click(cells()[0]);
    await user.click(pad(8));
    const places = [...cells()[0].querySelectorAll('.notes > span')];
    expect(places).toHaveLength(9);
    expect(places[7].textContent).toBe('8');
    expect(places.filter((p) => p.textContent !== '')).toHaveLength(1);
  });

  test('the switch says which mode it is in', async () => {
    await start();
    expect(mode('Write').getAttribute('aria-pressed')).toBe('true');
    expect(mode('Notes').getAttribute('aria-pressed')).toBe('false');
    await userEvent.setup().click(mode('Notes'));
    expect(mode('Write').getAttribute('aria-pressed')).toBe('false');
    expect(mode('Notes').getAttribute('aria-pressed')).toBe('true');
  });

  test('a given cannot be changed', async () => {
    const { user } = await start();
    await user.click(cells()[10]);
    await user.click(pad(wrongDigit(10)));
    expect(valueOf(10)).toBe(String(SOLUTION[10]));
  });
});

describe('no marks', () => {
  test('a wrong digit renders the same as a right digit', async () => {
    const { user } = await start();
    await writeIn(user, 0, SOLUTION[0]);
    await writeIn(user, 1, wrongDigit(1));
    await user.click(cells()[40]); // moves the selection off both
    const right = cells()[0];
    const wrong = cells()[1];
    expect(right.className).toBe(wrong.className);
    const attrs = (el: Element) =>
      [...el.attributes].filter((a) => a.name !== 'aria-label').map((a) => `${a.name}=${a.value}`);
    expect(attrs(right)).toEqual(attrs(wrong));
    expect(right.innerHTML.replace(/\d/, 'N')).toBe(wrong.innerHTML.replace(/\d/, 'N'));
  });

  test('givens and written numbers differ, and only the selected square is lit', async () => {
    const { user } = await start();
    await writeIn(user, 0, 5);
    expect(cells()[0].className).toBe('cell is-written is-selected');
    expect(cells()[10].className).toBe('cell is-given');
    expect(cells().filter((c) => c.classList.contains('is-selected'))).toEqual([cells()[0]]);
    expect(cells().filter((c) => c.getAttribute('aria-pressed') === 'true')).toEqual([cells()[0]]);
    // every other square is just empty, given or written: no row, column or same-number light
    const kinds = new Set(cells().slice(1).map((c) => c.className));
    for (const k of kinds) expect(['cell', 'cell is-given', 'cell is-written']).toContain(k);
  });
});

describe('the end', () => {
  test('a full wrong board says not solved and does not mark any square', async () => {
    const { user } = await start();
    await fill(user, FIRST_BLANKS, wrongDigit);
    expect(note()).toBe('Not solved.');
    await user.click(cells()[40]);
    for (const c of FIRST_BLANKS) expect(cells()[c].className).toBe('cell is-written');
    for (const c of cells()) expect(['cell', 'cell is-given', 'cell is-written', 'cell is-given is-selected']).toContain(c.className);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('a full right board says won', async () => {
    const { user } = await start();
    await fill(user, FIRST_BLANKS, (c) => SOLUTION[c]);
    expect(note()).toBe('You won.');
  });

  test('return works from the not solved message', async () => {
    const { user } = await start();
    await fill(user, FIRST_BLANKS, wrongDigit);
    expect(note()).toBe('Not solved.');
    await user.click(screen.getByRole('button', { name: 'Return' }));
    expect(note()).toBe('');
    expect(cells()[2].getAttribute('aria-label')).toMatch(/empty/);
  });

  test('the message stays through more edits and clears once a square is emptied', async () => {
    const { user } = await start();
    await fill(user, FIRST_BLANKS, wrongDigit);
    await writeIn(user, 2, ((SOLUTION[2] + 1) % 9) + 1); // another wrong digit, still full
    expect(note()).toBe('Not solved.');
    await user.click(pad(Number(valueOf(2)))); // the same digit again empties it
    expect(note()).toBe('');
  });

  test('fixing the board after not solved wins', async () => {
    const { user } = await start();
    await fill(user, FIRST_BLANKS, wrongDigit);
    await fill(user, FIRST_BLANKS, (c) => SOLUTION[c]);
    expect(note()).toBe('You won.');
  });

  test('a won board takes no more digits', async () => {
    const { user } = await start();
    await fill(user, FIRST_BLANKS, (c) => SOLUTION[c]);
    await user.click(cells()[0]);
    await user.click(pad(wrongDigit(0)));
    expect(valueOf(0)).toBe(String(SOLUTION[0]));
    expect(note()).toBe('You won.');
  });
});

describe('new game', () => {
  test('asks once in the page, and a confirming tap deals a different puzzle of the level', async () => {
    const confirm = vi.fn();
    const alert = vi.fn();
    vi.stubGlobal('confirm', confirm);
    vi.stubGlobal('alert', alert);
    const { user } = await start();
    await writeIn(user, 0, 4);

    await user.click(screen.getByRole('button', { name: 'New game' }));
    const dialog = screen.getByRole('alertdialog');
    expect(valueOf(0)).toBe('4'); // nothing has changed yet

    await user.click(within(dialog).getByRole('button', { name: 'Start new game' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // the other easy puzzle: its first squares are given, squares 40 to 42 are empty
    expect(cells()[0].getAttribute('aria-label')).toMatch(/given/);
    for (const c of SECOND_BLANKS) expect(cells()[c].getAttribute('aria-label')).toMatch(/empty/);
    expect(confirm).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  test('keep playing or Escape closes the question and changes nothing', async () => {
    const { user } = await start();
    await writeIn(user, 0, 4);
    const button = screen.getByRole('button', { name: 'New game' });
    await user.click(button);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep playing' }));
    await user.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(button);
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(valueOf(0)).toBe('4');
  });

  test('does not ask once the game is won', async () => {
    const { user } = await start();
    await fill(user, FIRST_BLANKS, (c) => SOLUTION[c]);
    await user.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(cells()[40].getAttribute('aria-label')).toMatch(/empty/);
    expect(note()).toBe('');
  });

  test('a level with one puzzle deals that one again', async () => {
    const { user } = await start('Hard');
    await writeIn(user, 80, 1);
    await user.click(screen.getByRole('button', { name: 'New game' }));
    await user.click(screen.getByRole('button', { name: 'Start new game' }));
    expect(cells()[80].getAttribute('aria-label')).toMatch(/empty/);
  });
});
