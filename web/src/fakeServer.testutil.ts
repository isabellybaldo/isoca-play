import { vi } from 'vitest';
import { FACES, LAYOUTS, type Level } from './mahjong/layouts';
import type { Puzzle } from './sudoku/rules';

export const SOLUTION = '687251934254893167931467852793146528415328679862579341128735496349682715576914283';

// The solved board with a few squares blanked, which is all the screens need.
export function blanked(level: Level, cells: number[]): Puzzle {
  return {
    level,
    solution: SOLUTION,
    givens: [...SOLUTION].map((ch, i) => (cells.includes(i) ? '.' : ch)).join(''),
  };
}

const PACK = [
  blanked('easy', [0, 1, 2]),
  blanked('easy', [40, 41, 42]),
  blanked('medium', [10, 11, 12]),
  blanked('hard', [78, 79, 80]),
  blanked('hard', [60, 61, 62]),
];

// Two deals are enough: the screens only need one that is not the one on show.
export const DEALS = [Array.from({ length: 52 }, (_, i) => i), Array.from({ length: 52 }, (_, i) => 51 - i)];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export type Seen = { method: string; path: string; body?: unknown };

// BroadcastChannel between tabs in one test: delivered to the others, soon after, as a
// browser does.
const open = new Set<FakeChannel>();
class FakeChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(private name: string) {
    open.add(this);
  }
  postMessage(data: unknown) {
    for (const other of open) {
      if (other !== this && other.name === this.name) {
        queueMicrotask(() => other.onmessage?.({ data } as MessageEvent));
      }
    }
  }
  close() {
    open.delete(this);
  }
}

// The server's routes as the app sees them, stubbed in for fetch. `answer` overrides a
// request: return a status to refuse it, or throw for a network failure.
export function fakeServer(saves: Record<string, unknown> = {}) {
  const server = {
    saves,
    stats: { public: null, private: { daily: [], current_streak: 0 } } as unknown,
    requests: [] as Seen[],
    answer: null as null | ((seen: Seen) => number | undefined),
    gate: null as null | Promise<unknown>, // a request waits here before it is answered
    // The network is gone and the worker answers: a game here comes back marked as
    // cached (null for a cached "no save"), any other request fails as a network failure.
    worker: null as null | Record<string, unknown>,
    puts: (game: string) =>
      server.requests.filter((r) => r.method === 'PUT' && r.path === `/api/save/${game}`).map((r) => r.body),
  };
  open.clear();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const seen: Seen = { method, path, body };
    server.requests.push(seen);
    if (server.gate) await server.gate;
    if (server.worker) {
      const game = /^\/api\/save\/(\w+)$/.exec(path)?.[1];
      if (method !== 'GET' || !game || !(game in server.worker)) throw new TypeError('Failed to fetch');
      const kept = server.worker[game];
      const headers = { 'Content-Type': 'application/json', 'X-Isoca-Cached': '1' };
      return kept === null
        ? new Response(null, { status: 204, headers })
        : new Response(JSON.stringify(kept), { status: 200, headers });
    }
    const refused = server.answer?.(seen);
    if (refused !== undefined) return json({ detail: 'refused' }, refused);

    const save = /^\/api\/save\/(\w+)$/.exec(path);
    if (save && method === 'GET') {
      return save[1] in server.saves ? json(server.saves[save[1]]) : new Response(null, { status: 204 });
    }
    if (save && method === 'PUT') {
      server.saves[save[1]] = body;
      return new Response(null, { status: 204 });
    }
    if (path === '/api/new/mahjong') {
      const layout = LAYOUTS.find((l) => l.id === body.layout)!;
      const tiles = layout.cells.map((c, id) => ({ id, ...c, face: FACES[(id >> 1) % FACES.length] }));
      return json({ layout: layout.id, tiles });
    }
    if (path === '/api/new/sudoku') {
      return json(PACK.find((p) => p.level === body.level && p.givens !== body.not)!);
    }
    if (path === '/api/new/solitaire') {
      return json({ deal: DEALS.find((d) => JSON.stringify(d) !== JSON.stringify(body.not)) });
    }
    if (path === '/api/stats/game') return new Response(null, { status: 204 });
    if (path.startsWith('/api/stats')) return json(server.stats);
    if (path === '/logout') return new Response(null, { status: 200 });
    return json({ detail: 'no route' }, 404);
  });
  return server;
}

export function goOffline(offline = true) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(!offline);
  window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
}
