import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { StatsAnswer } from './api';
import App from './App';
import { fakeServer, goOffline } from './fakeServer.testutil';
import Stats from './Stats';

const counted = { played: 4, won: 3, win_rate: 75, avg_win_seconds: 95, best_win_seconds: 61 };
const ANSWER: StatsAnswer = {
  public: {
    games: [
      {
        game: 'mahjong',
        ...counted,
        lost: 1,
        abandoned: 0,
        avg_returns: 2,
        avg_tips: 1,
        levels: [{ level: 'hard', ...counted }],
      },
    ],
    maps: [{ map: 'fort', name: 'Fort', played: 1, won: 0, win_rate: 0, avg_win_seconds: null, best_win_seconds: null, lost: 1, abandoned: 0 }],
    longest_streak: 6,
  },
  private: { daily: [{ day: '2026-11-01', games: 0 }, { day: '2026-11-02', games: 2 }], current_streak: 3 },
};
const NOTHING: StatsAnswer = { public: null, private: { daily: [{ day: '2026-11-02', games: 0 }], current_streak: 0 } };

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function open(stats: unknown, online = true) {
  const server = fakeServer();
  server.stats = stats;
  const onBack = vi.fn();
  render(<Stats online={online} onBack={onBack} />);
  await settle();
  return { server, onBack };
}

test('Home has a Stats button that opens the screen, and Back returns', async () => {
  const server = fakeServer();
  server.stats = ANSWER;
  const user = userEvent.setup();
  render(<App />);
  await settle();
  await user.click(screen.getByRole('button', { name: 'Stats' }));
  expect(await screen.findByRole('heading', { name: 'Stats' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Back to home' }));
  expect(screen.getByRole('heading', { name: 'isoca play' })).toBeTruthy();
});

test('shows every public number, plus games per day and the current streak', async () => {
  await open(ANSWER);
  const text = document.body.textContent!;
  for (const shown of [
    'Mahjong', '4 played', '3 won', '75%', 'average win 1:35', 'best 1:01', '1 lost', '0 abandoned',
    'Average returns 2', 'tips 1', 'Hard', 'Fort', 'Longest streak: 6', 'Current streak: 3', '2026-11-02: 2',
  ]) {
    expect(text).toContain(shown);
  }
});

test('asks with the device’s own date', async () => {
  const { server } = await open(ANSWER);
  expect(server.requests.at(-1)!.path).toMatch(/^\/api\/stats\?today=\d{4}-\d{2}-\d{2}$/);
});

test('a number built from nothing shows a dash', async () => {
  await open(ANSWER);
  expect(screen.getByText(/^Fort:/).textContent).toContain('average win –, best –');
});

test('with no games yet it says so, with no row of zeros', async () => {
  await open(NOTHING);
  expect(screen.getByText('No games recorded yet.')).toBeTruthy();
  expect(document.body.textContent).not.toContain('0 played');
  expect(document.body.textContent).not.toContain('2026-11-02');
});

test('offline it says it needs a connection and asks nothing', async () => {
  goOffline();
  const { server } = await open(ANSWER, false);
  expect(screen.getByText('Stats need a connection.')).toBeTruthy();
  expect(server.requests.filter((r) => r.path.startsWith('/api/stats'))).toEqual([]);
});

test('a failed request says so and offers another try', async () => {
  const server = fakeServer();
  server.stats = ANSWER;
  server.answer = () => 500;
  const user = userEvent.setup();
  render(<Stats online onBack={vi.fn()} />);
  await settle();
  expect(screen.getByText('That did not work.')).toBeTruthy();
  server.answer = null;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await settle();
  expect(screen.getByText(/Longest streak: 6/)).toBeTruthy();
});
