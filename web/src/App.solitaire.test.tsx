import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { goToLogin } from './api';
import App from './App';
import { DEALS, fakeServer } from './fakeServer.testutil';
import { newSolitaire, tapPile } from './solitaire/rules';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  goToLogin: vi.fn(),
}));

// The home page has no solitaire card yet, so this stands in for it.
vi.mock('./Home', () => ({
  default: ({ onOpen, onLogOut }: { onOpen: (screen: 'solitaire') => void; onLogOut: () => void }) => (
    <main>
      <h1>isoca play</h1>
      <button type="button" onClick={() => onOpen('solitaire')}>Solitaire</button>
      <button type="button" onClick={onLogOut}>Log out</button>
    </main>
  ),
}));

// A save can pass every check and still not draw; this stands in for whatever that is.
const draws = vi.hoisted(() => ({ fail: false }));
vi.mock('./solitaire/SolitaireTable', async (importOriginal) => {
  const real = await importOriginal<typeof import('./solitaire/SolitaireTable')>();
  return {
    ...real,
    default: (props: Parameters<typeof real.default>[0]) => {
      if (draws.fail) throw new Error('does not draw');
      return <real.default {...props} />;
    },
  };
});

afterEach(() => {
  cleanup();
  draws.fail = false;
  vi.mocked(goToLogin).mockClear();
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

const button = (name: string) => screen.getByRole('button', { name });

test('opening solitaire with no save deals, saves, and Back goes home', async () => {
  const server = fakeServer();
  const user = userEvent.setup();
  await open();
  expect(server.requests.some((r) => r.path === '/api/new/solitaire')).toBe(false);

  await user.click(button('Solitaire'));
  await settle();
  expect(server.puts('solitaire')).toEqual([newSolitaire(DEALS[0])]);
  expect(button('Pile, 24 cards')).toBeTruthy();

  await user.click(button('Back to home'));
  expect(screen.getByRole('heading', { name: 'isoca play' })).toBeTruthy();
});

test('a saved game opens as it was, and sends nothing', async () => {
  const saved = tapPile(newSolitaire(DEALS[0]));
  const server = fakeServer({ solitaire: saved });
  const user = userEvent.setup();
  await open();
  await user.click(button('Solitaire'));
  await settle();
  expect(button('Pile, 23 cards')).toBeTruthy();
  expect(server.puts('solitaire')).toEqual([]);
});

describe('a load answered from the device says nothing about the server', () => {
  const past1s = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
  const nothingSent = (server: ReturnType<typeof fakeServer>) => {
    expect(server.requests.some((r) => r.path === '/api/new/solitaire')).toBe(false);
    expect(server.puts('solitaire')).toEqual([]);
  };
  async function openOnCachedNothing(server: ReturnType<typeof fakeServer>) {
    server.worker = { mahjong: null, solitaire: null, sudoku: null };
    await open();
    await userEvent.setup().click(button('Solitaire'));
    await settle();
    // navigator.onLine says online throughout, and the deal route works.
    nothingSent(server);
    expect(screen.getByText('New games need a connection.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New game' })).toBeNull();
  }

  test('a game on the server is adopted once it answers, with nothing sent', async () => {
    const server = fakeServer();
    await openOnCachedNothing(server);
    server.saves.solitaire = tapPile(newSolitaire(DEALS[0]));
    server.worker = null;
    await past1s();
    expect(button('Pile, 23 cards')).toBeTruthy();
    nothingSent(server);
  });

  test('an unreadable save on the server is not replaced without its tap', async () => {
    const server = fakeServer();
    await openOnCachedNothing(server);
    server.saves.solitaire = { nonsense: true };
    server.worker = null;
    await past1s();
    expect(screen.getByText('The saved game could not be opened.')).toBeTruthy();
    nothingSent(server);
    expect(server.saves.solitaire).toEqual({ nonsense: true });
  });

  test('a server that truly has nothing gets its deal', async () => {
    const server = fakeServer();
    await openOnCachedNothing(server);
    server.worker = null;
    await past1s();
    expect(button('Pile, 24 cards')).toBeTruthy();
    expect(server.puts('solitaire')).toEqual([newSolitaire(DEALS[0])]);
  });
});

test('log out waits for a solitaire move on its way', async () => {
  const server = fakeServer();
  const user = userEvent.setup();
  await open();
  await user.click(button('Solitaire'));
  await settle();
  await user.click(button('Back to home'));
  await user.click(button('Log out'));
  await settle();
  const paths = server.requests.map((r) => `${r.method} ${r.path}`);
  expect(paths.lastIndexOf('PUT /api/save/solitaire')).toBeLessThan(paths.indexOf('POST /logout'));
  expect(paths.lastIndexOf('PUT /api/save/solitaire')).toBeGreaterThan(-1);
});

test('the marker hears from solitaire too', async () => {
  const server = fakeServer();
  server.answer = ({ method, path }) => (method === 'PUT' && path === '/api/save/solitaire' ? 413 : undefined);
  const user = userEvent.setup();
  const { container } = await open();
  await user.click(button('Solitaire'));
  await settle();
  expect(container.querySelector('.save-marker')!.textContent).toBe('Not saved: the server refused this.');
});

test('a solitaire that will not draw: New game leaves the save alone until confirmed', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  draws.fail = true;
  const saved = tapPile(newSolitaire(DEALS[0]));
  const server = fakeServer({ solitaire: saved });
  const user = userEvent.setup();
  await open();
  await user.click(button('Solitaire'));
  expect(screen.getByText('This game could not be opened.')).toBeTruthy();

  await user.click(button('New game'));
  await settle();
  expect(screen.getByText('The saved game could not be opened.')).toBeTruthy();
  expect(server.requests.some((r) => r.path === '/api/new/solitaire')).toBe(false);
  expect(server.puts('solitaire')).toEqual([]);
});
