import { StrictMode, useState, type SetStateAction } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { REPLACE_UNPLAYABLE } from '../api';
import { DEALS, fakeServer } from '../fakeServer.testutil';
import { newSolitaire, tapPile, type SolitaireState } from './rules';
import SolitaireGame from './SolitaireGame';

const [FIRST, SECOND] = DEALS;
const FRESH = newSolitaire(FIRST);
const PLAYED = tapPile(FRESH);
const WON: SolitaireState = {
  ...FRESH,
  stock: [],
  waste: [],
  columns: FRESH.columns.map(() => ({ down: [], up: [] })),
  foundations: [13, 13, 13, 13],
  history: ['d'],
  status: 'won',
};

let server: ReturnType<typeof fakeServer>;
let holding: { game: SolitaireState | null; set: (g: SetStateAction<SolitaireState | null>) => void };

beforeEach(() => {
  server = fakeServer();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Props = { ready?: boolean; online?: boolean; unplayable?: boolean; onBack?: () => void; check?: () => Promise<boolean> };

// The game itself lives above the screen; this stands in for App.
function Holder({ start = null, ready = true, online = true, unplayable = false, onBack = () => {}, check = async () => true }: Props & { start?: SolitaireState | null }) {
  const [game, set] = useState(start);
  holding = { game, set };
  return <SolitaireGame game={game} onGame={set} ready={ready} online={online} unplayable={unplayable} check={check} onBack={onBack} />;
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function open(start: SolitaireState | null, props: Props = {}) {
  render(<Holder start={start} {...props} />);
  await settle();
  return userEvent.setup();
}

const deals = () => server.requests.filter((r) => r.path === '/api/new/solitaire');
const line = () => screen.getByRole('status').textContent;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const pile = () => screen.queryByRole('button', { name: /^Pile, |^Empty pile/ });

describe('opening', () => {
  test('a saved game opens at once, with no request for a deal', async () => {
    await open(PLAYED);
    expect(button('Pile, 23 cards')).toBeTruthy();
    expect(deals()).toEqual([]);
  });

  test('no save: one deal is asked for, with no confirming tap', async () => {
    render(
      <StrictMode>
        <Holder />
      </StrictMode>,
    );
    await settle();
    expect(deals()).toHaveLength(1);
    expect(deals()[0].body).toEqual({});
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(holding.game).toEqual(newSolitaire(FIRST));
    expect(button('Pile, 24 cards')).toBeTruthy();
  });

  test('no deal is asked for until the load has answered', async () => {
    await open(null, { ready: false });
    expect(deals()).toEqual([]);
    expect(line()).toBe('Loading your saved game.');
    expect(button('New game').disabled).toBe(true);
  });

  test('a load that answers with a game while no deal is out asks for none', async () => {
    const { rerender } = render(<Holder ready={false} />);
    await settle();
    act(() => holding.set(PLAYED));
    rerender(<Holder ready />);
    await settle();
    expect(deals()).toEqual([]);
    expect(button('Pile, 23 cards')).toBeTruthy();
  });

  test('a game arriving while a deal is on its way is not overwritten', async () => {
    let answer = () => {};
    server.gate = new Promise<void>((resolve) => (answer = resolve));
    await open(null);
    expect(deals()).toHaveLength(1);
    expect(line()).toBe('Starting a new game.');

    act(() => holding.set(PLAYED));
    server.gate = null;
    answer();
    await settle();
    expect(holding.game).toBe(PLAYED);
    expect(line()).toBe('');
  });

  test('offline with no save: the note and Back, no request', async () => {
    const onBack = vi.fn();
    const user = await open(null, { online: false, onBack });
    expect(deals()).toEqual([]);
    expect(line()).toBe('New games need a connection.');
    expect(pile()).toBeNull();
    expect(screen.queryByRole('button', { name: 'New game' })).toBeNull();
    await user.click(button('Back to home'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  test('with no save, coming back online asks for the deal', async () => {
    const { rerender } = render(<Holder online={false} />);
    await settle();
    rerender(<Holder online />);
    await settle();
    expect(deals()).toHaveLength(1);
    expect(button('Pile, 24 cards')).toBeTruthy();
  });

  test('an unreadable save is not replaced until New game is confirmed', async () => {
    const user = await open(null, { unplayable: true });
    expect(deals()).toEqual([]);
    expect(line()).toBe('The saved game could not be opened.');
    expect(pile()).toBeNull();

    await user.click(button('New game'));
    expect(screen.getByRole('alertdialog').textContent).toContain(REPLACE_UNPLAYABLE);
    expect(screen.queryByRole('button', { name: 'Keep playing' })).toBeNull();
    await user.click(button('Not now'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(deals()).toEqual([]);
    expect(pile()).toBeNull();

    await user.click(button('New game'));
    await user.click(button('Start new game'));
    await settle();
    expect(deals()).toHaveLength(1);
    expect(button('Pile, 24 cards')).toBeTruthy();
  });

  test('a failed deal shows the problem, and New game tries again', async () => {
    server.answer = ({ path }) => (path === '/api/new/solitaire' ? 503 : undefined);
    const user = await open(null);
    expect(deals()).toHaveLength(1);
    expect(line()).toBe('That did not work. Try again.');
    expect(pile()).toBeNull();

    server.answer = null;
    await user.click(button('New game'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await settle();
    expect(deals()).toHaveLength(2);
    expect(line()).toBe('');
    expect(button('Pile, 24 cards')).toBeTruthy();
  });

  test('a logged out deal says to log in', async () => {
    server.answer = ({ path }) => (path === '/api/new/solitaire' ? 401 : undefined);
    await open(null);
    expect(line()).toBe('Log in again to start a new game.');
  });
});

describe('before the first deal', () => {
  test('no deal until the check has answered, and New game waits for it', async () => {
    let answer = (_clear: boolean) => {};
    const check = () => new Promise<boolean>((resolve) => (answer = resolve));
    await open(null, { check });
    expect(deals()).toEqual([]);
    expect(button('New game').disabled).toBe(true);
    await act(async () => answer(true));
    await settle();
    expect(deals()).toHaveLength(1);
  });

  test('a check that says no deals nothing, and coming back online asks again', async () => {
    const check = vi.fn(async () => false);
    const { rerender } = render(<Holder check={check} />);
    await settle();
    expect(deals()).toEqual([]);
    expect(line()).toBe('');
    expect(button('New game').disabled).toBe(false);

    check.mockImplementation(async () => true);
    rerender(<Holder check={check} online={false} />);
    await settle();
    rerender(<Holder check={check} online />);
    await settle();
    expect(check).toHaveBeenCalledTimes(2);
    expect(deals()).toHaveLength(1);
  });

  test('a check that fails deals nothing and shows the note', async () => {
    await open(null, { check: () => Promise.reject(new Error('no answer')) });
    expect(deals()).toEqual([]);
    expect(line()).toBe('That did not work. Try again.');
  });

  test('New game by tap does not check', async () => {
    const check = vi.fn(async () => true);
    const user = await open(FRESH, { check });
    await user.click(button('New game'));
    await settle();
    expect(check).not.toHaveBeenCalled();
    expect(deals()).toHaveLength(1);
  });
});

describe('a screen too short for the longest column', () => {
  const sized = (width: number, height: number) => {
    window.innerWidth = width;
    window.innerHeight = height;
  };
  afterEach(() => sized(1024, 768));

  test('says to turn the phone, and play stays allowed', async () => {
    sized(740, 360);
    const user = await open(PLAYED);
    expect(line()).toBe('Turn the phone upright.');
    await user.click(button('Pile, 23 cards'));
    expect(holding.game!.history).toHaveLength(2);
  });

  test('says nothing upright, or with no cards on the table', async () => {
    sized(360, 640);
    await open(PLAYED);
    expect(line()).toBe('');
    cleanup();
    sized(740, 360);
    await open(null, { unplayable: true });
    expect(line()).toBe('The saved game could not be opened.');
  });

  test('follows a turn of the phone', async () => {
    sized(360, 640);
    await open(PLAYED);
    sized(740, 360);
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(line()).toBe('Turn the phone upright.');
  });

  test('a tip, a win and a problem are shown over it', async () => {
    sized(740, 360);
    server.answer = ({ path }) => (path === '/api/new/solitaire' ? 503 : undefined);
    const user = await open(FRESH);
    await user.click(button('Tip'));
    expect(line()).not.toBe('Turn the phone upright.');
    expect(line()!.length).toBeGreaterThan(0);
    await user.click(button('New game'));
    await settle();
    expect(line()).toBe('That did not work. Try again.');
    cleanup();
    await open(WON);
    expect(line()).toBe('You won.');
  });

  test('it takes the place of the offline note', async () => {
    sized(740, 360);
    await open(PLAYED, { online: false });
    expect(line()).toBe('Turn the phone upright.');
  });
});

describe('New game', () => {
  test('New game with moves asks first; Keep playing stays on the table', async () => {
    const user = await open(PLAYED);
    await user.click(button('New game'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(deals()).toEqual([]);
    await user.click(button('Keep playing'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(holding.game).toBe(PLAYED);
    expect(deals()).toEqual([]);

    await user.click(button('New game'));
    await user.click(button('Start new game'));
    await settle();
    expect(holding.game).toEqual(newSolitaire(SECOND));
  });

  test.each([
    ['no moves', FRESH],
    ['after a win', WON],
  ])('New game with %s does not ask', async (_name, start) => {
    const user = await open(start);
    await user.click(button('New game'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await settle();
    expect(deals()).toHaveLength(1);
    expect(holding.game).toEqual(newSolitaire(SECOND));
  });

  test('New game is disabled offline, with the note', async () => {
    await open(PLAYED, { online: false });
    expect(button('New game').disabled).toBe(true);
    expect(line()).toBe('New games need a connection.');
    expect(pile()).toBeTruthy();
  });

  test('New game sends the deal on screen as not', async () => {
    const user = await open(FRESH);
    await user.click(button('New game'));
    await settle();
    expect(deals()[0].body).toEqual({ not: FRESH.deal });
    expect(holding.game!.deal).not.toEqual(FRESH.deal);
  });

  // The request is held until `during` has happened.
  async function answeredAfter(tap: () => Promise<void>, during: () => void) {
    let answer = () => {};
    server.gate = new Promise<void>((resolve) => (answer = resolve));
    await tap();
    await settle();
    act(during);
    server.gate = null;
    answer();
    await settle();
  }

  test('a New game that asked nothing keeps a game that has since got moves', async () => {
    const user = await open(FRESH);
    await answeredAfter(() => user.click(button('New game')), () => holding.set((s) => s && tapPile(s)));
    expect(holding.game!.deal).toEqual(FRESH.deal);
    expect(holding.game!.history).toEqual(['d']);
  });

  test('a New game that asked nothing keeps moves that arrived from another device', async () => {
    const user = await open(WON);
    await answeredAfter(() => user.click(button('New game')), () => holding.set(PLAYED));
    expect(holding.game).toBe(PLAYED);
  });

  test('a New game that asked nothing still replaces a game with nothing to lose', async () => {
    const user = await open(FRESH);
    await answeredAfter(() => user.click(button('New game')), () => holding.set(WON));
    expect(holding.game).toEqual(newSolitaire(SECOND));
  });

  test('a confirmed New game replaces the game, whatever has happened since', async () => {
    const user = await open(PLAYED);
    await user.click(button('New game'));
    await answeredAfter(() => user.click(button('Start new game')), () => holding.set((s) => s && tapPile(s)));
    expect(holding.game).toEqual(newSolitaire(SECOND));
  });

  test('a New game that fails leaves the game alone and says so', async () => {
    server.answer = ({ path }) => (path === '/api/new/solitaire' ? 503 : undefined);
    const user = await open(FRESH);
    await user.click(button('New game'));
    await settle();
    expect(holding.game).toBe(FRESH);
    expect(line()).toBe('That did not work. Try again.');
  });
});

describe('the bar and the line', () => {
  test('Back goes home', async () => {
    const onBack = vi.fn();
    const user = await open(PLAYED, { onBack });
    await user.click(button('Back to home'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  test('Return is disabled with no history', async () => {
    await open(FRESH);
    expect(button('Return').disabled).toBe(true);
  });

  test('Return takes back a move', async () => {
    const user = await open(PLAYED);
    await user.click(button('Return'));
    expect(holding.game!.history).toEqual([]);
    expect(button('Return').disabled).toBe(true);
  });

  test('Tip is disabled after a win', async () => {
    await open(WON);
    expect(button('Tip').disabled).toBe(true);
  });

  test('with no game there is only the note, Back and New game', async () => {
    await open(null, { unplayable: true });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Back', 'New game']);
    expect(line()).toBe('The saved game could not be opened.');
  });

  test('with no game and no connection there is only the note and Back', async () => {
    await open(null, { online: false });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Back']);
  });

  test('a problem goes once the game moves on, and does not hide a win', async () => {
    server.answer = ({ path }) => (path === '/api/new/solitaire' ? 503 : undefined);
    const user = await open(FRESH);
    await user.click(button('New game'));
    await settle();
    expect(line()).toBe('That did not work. Try again.');

    act(() => holding.set(WON));
    expect(line()).toBe('You won.');
  });

  test('a problem goes with a move, and with a game from another deal', async () => {
    server.answer = ({ path }) => (path === '/api/new/solitaire' ? 503 : undefined);
    const user = await open(FRESH);
    await user.click(button('New game'));
    await settle();
    act(() => holding.set((s) => s && tapPile(s)));
    expect(line()).toBe('');

    await user.click(button('New game'));
    await user.click(button('Start new game'));
    await settle();
    expect(line()).toBe('That did not work. Try again.');
    act(() => holding.set(newSolitaire(SECOND)));
    expect(line()).toBe('');
  });

  test('a win shows its note', async () => {
    await open(WON);
    expect(line()).toBe('You won.');
  });

  test('a tip shows its line, offline too, and a move ends it', async () => {
    const user = await open(FRESH, { online: false });
    await user.click(button('Tip'));
    expect(line()).not.toBe('New games need a connection.');
    expect(line()!.length).toBeGreaterThan(0);
    act(() => holding.set((s) => s && tapPile(s)));
    expect(line()).toBe('New games need a connection.');
  });

  test('a New game that fails is seen over a tip, and asking again shows the tip', async () => {
    server.answer = ({ path }) => (path === '/api/new/solitaire' ? 503 : undefined);
    const user = await open(FRESH);
    await user.click(button('Tip'));
    const said = line();
    await user.click(button('New game'));
    await settle();
    expect(line()).toBe('That did not work. Try again.');
    await user.click(button('Tip'));
    expect(line()).toBe(said);
  });

  test('the line is always there, empty when there is nothing to say', async () => {
    await open(FRESH);
    expect(line()).toBe('');
  });

  test('behind the question, the table cannot be reached', async () => {
    const user = await open(PLAYED);
    await user.click(button('New game'));
    expect(screen.getByRole('main').hasAttribute('inert')).toBe(true);
  });
});
