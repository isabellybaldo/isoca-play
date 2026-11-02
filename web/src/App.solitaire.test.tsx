import { StrictMode } from 'react';
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

// The home card's name is its whole text, so 'Solitaire' alone is matched as a start.
const button = (name: string) => screen.getByRole('button', { name: name === 'Solitaire' ? /^Solitaire/ : name });

test('opening solitaire with no save deals, saves, and Back goes home', async () => {
  const server = fakeServer();
  const user = userEvent.setup();
  await open();
  expect(server.requests.some((r) => r.path === '/api/new/solitaire')).toBe(false);

  await user.click(button('Solitaire'));
  await settle();
  expect(server.puts('solitaire')).toEqual([expect.objectContaining(newSolitaire(DEALS[0]))]);
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
    expect(server.puts('solitaire')).toEqual([expect.objectContaining(newSolitaire(DEALS[0]))]);
  });
});

// A tab that loaded "no save" and has had no wake since: only the screen opening can ask again.
describe('the first deal asks the server again', () => {
  const noDealNoSave = (server: ReturnType<typeof fakeServer>) => {
    expect(server.requests.some((r) => r.path === '/api/new/solitaire')).toBe(false);
    expect(server.puts('solitaire')).toEqual([]);
  };
  const askedSolitaire = (server: ReturnType<typeof fakeServer>) =>
    server.requests.filter((r) => r.method === 'GET' && r.path === '/api/save/solitaire').length;

  test('a game started elsewhere since the load is shown, with nothing sent', async () => {
    const saved = tapPile(newSolitaire(DEALS[0]));
    const server = fakeServer();
    await open();
    server.saves.solitaire = saved;
    await userEvent.setup().click(button('Solitaire'));
    await settle();
    expect(button('Pile, 23 cards')).toBeTruthy();
    noDealNoSave(server);
    expect(server.saves.solitaire).toEqual(saved);
  });

  test('an unreadable save that has appeared is left alone', async () => {
    const server = fakeServer();
    await open();
    server.saves.solitaire = { nonsense: true };
    await userEvent.setup().click(button('Solitaire'));
    await settle();
    expect(screen.getByText('The saved game could not be opened.')).toBeTruthy();
    noDealNoSave(server);
  });

  test('nothing on the server still deals once with no tap, under StrictMode', async () => {
    const server = fakeServer();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await settle();
    const before = askedSolitaire(server);
    await userEvent.setup().click(button('Solitaire'));
    await settle();
    expect(askedSolitaire(server)).toBe(before + 1);
    expect(server.requests.filter((r) => r.path === '/api/new/solitaire')).toHaveLength(1);
    expect(server.puts('solitaire')).toEqual([expect.objectContaining(newSolitaire(DEALS[0]))]);
    expect(button('Pile, 24 cards')).toBeTruthy();
  });

  test('a cached answer deals nothing, says so, and the real answer then decides', async () => {
    const server = fakeServer();
    await open();
    server.worker = { solitaire: null };
    await userEvent.setup().click(button('Solitaire'));
    await settle();
    noDealNoSave(server);
    expect(screen.getByText('New games need a connection.')).toBeTruthy();

    server.worker = null;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    expect(button('Pile, 24 cards')).toBeTruthy();
    expect(server.puts('solitaire')).toEqual([expect.objectContaining(newSolitaire(DEALS[0]))]);
  });

  test('a failed ask deals nothing and shows the note', async () => {
    const server = fakeServer();
    await open();
    server.answer = ({ method, path }) => (method === 'GET' && path === '/api/save/solitaire' ? 503 : undefined);
    await userEvent.setup().click(button('Solitaire'));
    await settle();
    noDealNoSave(server);
    expect(screen.getByText('That did not work. Try again.')).toBeTruthy();
  });

  test('a logged out ask says to log in', async () => {
    const server = fakeServer();
    await open();
    server.answer = ({ method, path }) => (method === 'GET' && path === '/api/save/solitaire' ? 401 : undefined);
    await userEvent.setup().click(button('Solitaire'));
    await settle();
    noDealNoSave(server);
    expect(screen.getByText('Log in again to start a new game.')).toBeTruthy();
  });

  test('New game by tap needs no second ask', async () => {
    const saved = newSolitaire(DEALS[0]);
    const server = fakeServer({ solitaire: saved });
    const user = userEvent.setup();
    await open();
    await user.click(button('Solitaire'));
    await settle();
    const before = askedSolitaire(server);
    await user.click(button('New game'));
    await settle();
    expect(askedSolitaire(server)).toBe(before);
    expect(server.puts('solitaire')).toEqual([expect.objectContaining(newSolitaire(DEALS[1]))]);
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
