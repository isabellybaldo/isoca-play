// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CACHED_HEADER, clearDevice, registerWorker } from './offline';

const ORIGIN = 'https://play.test';
const SAVES = 'isoca-play-saves';
const APP = 'isoca-play-app-v2';
const ASSET = '/assets/app-abc12345.js';
const source = readFileSync(join(import.meta.dirname, '..', 'public', 'sw.js'), 'utf8')
  .replace('__SW_VERSION__', 'v2')
  .replace(`['__SW_ASSETS__']`, JSON.stringify([ASSET]));

const pathOf = (key: string | Request) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).pathname;

// What the worker reads off a response that `new Response` cannot set by itself.
function from(response: Response, { redirected = false, type = 'basic' } = {}) {
  Object.defineProperty(response, 'redirected', { value: redirected });
  Object.defineProperty(response, 'type', { value: type });
  return response;
}
const ok = (text = 'ok') => from(new Response(text));

function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      put: async (key: string | Request, response: Response) => void store.set(pathOf(key), response.clone()),
      match: async (key: string | Request) => store.get(pathOf(key))?.clone(),
      delete: async (key: string | Request) => store.delete(pathOf(key)),
    };
  };
  return {
    open: async (name: string) => open(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (key: string | Request, options?: { cacheName?: string }) => {
      if (options?.cacheName) return stores.get(options.cacheName)?.get(pathOf(key))?.clone();
      for (const store of stores.values()) {
        const found = store.get(pathOf(key));
        if (found) return found.clone();
      }
      return undefined;
    },
    held: (name: string, path: string) => stores.get(name)?.get(path)?.clone(),
  };
}

// The hand-written worker, run as it is, with its browser around it.
function worker(network: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const listeners: Record<string, (event: never) => void> = {};
  const caches = fakeCaches();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name: string, listener: (event: never) => void) => {
      listeners[name] = listener;
    },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  const fetchIt = vi.fn(async (input: string | Request, init?: RequestInit) => network(pathOf(input), init));
  new Function('self', 'caches', 'fetch', source)(self, caches, fetchIt);

  const lifecycle = async (name: 'install' | 'activate') => {
    let done: Promise<unknown> = Promise.resolve();
    listeners[name]({ waitUntil: (p: Promise<unknown>) => (done = p) } as never);
    await done;
  };
  // answer is undefined when the worker left the request alone.
  const send = (path: string, init: RequestInit & { navigate?: boolean } = {}) => {
    let answer: Promise<Response> | undefined;
    const { navigate, ...rest } = init;
    const req = new Request(new URL(path, ORIGIN), rest);
    if (navigate) Object.defineProperty(req, 'mode', { value: 'navigate' });
    listeners.fetch({
      request: req,
      respondWith: (p: Promise<Response>) => (answer = Promise.resolve(p)),
      waitUntil: () => {},
    } as never);
    return { answer };
  };
  const request = async (path: string, init: RequestInit & { navigate?: boolean } = {}) => send(path, init).answer;
  // What clearDevice sends. Resolves when the worker answers on the port.
  const told = () =>
    new Promise<void>((resolve) => {
      listeners.message({
        data: { type: 'logging-out' },
        ports: [{ postMessage: () => resolve() }],
        waitUntil: () => {},
      } as never);
    });
  return { caches, self, fetchIt, lifecycle, request, send, told };
}

const noNetwork = (): Response => {
  throw new TypeError('Failed to fetch');
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('install', () => {
  test('keeps the shell and every asset under this version', async () => {
    const w = worker((path) => ok(`file ${path}`));
    await w.lifecycle('install');
    expect(await w.caches.held(APP, '/')!.text()).toBe('file /');
    expect(await w.caches.held(APP, ASSET)!.text()).toBe(`file ${ASSET}`);
  });

  test.each([
    ['a redirect to the login page', () => from(new Response('login'), { redirected: true })],
    ['a refusal', () => from(new Response('nope', { status: 404 }))],
    ['something from elsewhere', () => from(new Response('x'), { type: 'opaque' })],
  ])('%s fails the install and keeps nothing', async (_name, answer) => {
    const w = worker((path) => (path === '/' ? answer() : ok()));
    await expect(w.lifecycle('install')).rejects.toThrow();
    expect(await w.caches.keys()).toEqual([]);
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });

  test('one missing asset keeps nothing either', async () => {
    const w = worker((path) => (path === ASSET ? from(new Response('', { status: 404 })) : ok()));
    await expect(w.lifecycle('install')).rejects.toThrow();
    expect(await w.caches.keys()).toEqual([]);
  });
});

// Chrome stops the old worker to activate the new one. A navigation under way at that
// moment can hang, and a request landing then can lose the skipWaiting for 5 minutes
// (Chrome 156). So the new worker lets the load that found it finish, and asks again if
// it is still waiting.
describe('taking over after install', () => {
  afterEach(() => vi.useRealTimers());

  test('waits for the load under way, then keeps asking until it is activated', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = worker(() => ok());
    await w.lifecycle('install');
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.self.skipWaiting).toHaveBeenCalledTimes(2);
    void w.lifecycle('activate');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(w.self.skipWaiting).toHaveBeenCalledTimes(2);
  });

  test('gives up in the end, as a worker cannot wait for ever', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = worker(() => ok());
    await w.lifecycle('install');
    await vi.advanceTimersByTimeAsync(60_000);
    const asked = w.self.skipWaiting.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.self.skipWaiting).toHaveBeenCalledTimes(asked);
  });

  test('a failed install does not ask', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = worker(() => from(new Response('', { status: 404 })));
    await expect(w.lifecycle('install')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });
});

describe('activate', () => {
  const stored = async (w: ReturnType<typeof worker>, name: string, path: string, text: string) =>
    (await w.caches.open(name)).put(path, new Response(text));

  test('removes old caches, keeps the saves, and claims the pages', async () => {
    const w = worker(() => ok('{}'));
    await stored(w, 'isoca-play-app-v1', '/', 'old');
    await stored(w, 'other', '/x', 'old');
    await stored(w, APP, '/', 'new');
    await stored(w, SAVES, '/api/save/sudoku', 'kept');
    await w.lifecycle('activate');
    expect((await w.caches.keys()).sort()).toEqual([APP, SAVES].sort());
    expect(await w.caches.held(SAVES, '/api/save/sudoku')!.text()).toBe('kept');
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  test('fetches the saves the first page asked for before there was a worker', async () => {
    const w = worker((path) => (path === '/api/save/sudoku' ? ok('{"a":1}') : from(new Response(null, { status: 204 }))));
    await w.lifecycle('activate');
    expect(await w.caches.held(SAVES, '/api/save/sudoku')!.text()).toBe('{"a":1}');
    expect(w.caches.held(SAVES, '/api/save/mahjong')!.status).toBe(204);
  });

  test('does not replace a save it already holds, or keep a refusal, and survives no network', async () => {
    const w = worker((path) => (path === '/api/save/sudoku' ? ok('newer?') : from(new Response('{}', { status: 401 }))));
    await stored(w, SAVES, '/api/save/sudoku', 'kept');
    await w.lifecycle('activate');
    expect(await w.caches.held(SAVES, '/api/save/sudoku')!.text()).toBe('kept');
    expect(w.caches.held(SAVES, '/api/save/mahjong')).toBeUndefined();

    const off = worker(noNetwork);
    await off.lifecycle('activate');
    expect(off.self.clients.claim).toHaveBeenCalled();
  });
});

describe('activate on a link that hangs', () => {
  test('the missing saves give up in time, and the worker still claims the pages', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort());
    const w = worker(
      (_path, init) =>
        new Promise((_resolve, reject) => {
          const { signal } = init!;
          if (signal!.aborted) reject(signal!.reason);
          signal!.addEventListener('abort', () => reject(signal!.reason));
        }),
    );
    await w.lifecycle('activate');
    expect(AbortSignal.timeout).toHaveBeenCalledWith(3000);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });
});

describe('navigation', () => {
  const nav = { navigate: true };

  test('network first: the answer passes through and nothing is kept', async () => {
    const page = ok('fresh');
    const w = worker(() => page);
    expect(await w.request('/', nav)).toBe(page);
    expect(await w.caches.keys()).toEqual([]);
  });

  test('a redirect to login passes through when online, over a held shell', async () => {
    const redirect = from(new Response(null, { status: 200 }), { type: 'opaqueredirect' });
    let online = true;
    const w = worker(() => (online ? redirect : noNetwork()));
    await (await w.caches.open(APP)).put('/', new Response('shell'));
    expect(await w.request('/', nav)).toBe(redirect);
    expect(await w.caches.held(APP, '/')!.text()).toBe('shell');
    online = false;
    expect(await (await w.request('/', nav))!.text()).toBe('shell');
  });

  test('no network falls back to the shell, at any address', async () => {
    const w = worker(noNetwork);
    await (await w.caches.open(APP)).put('/', new Response('shell'));
    expect(await (await w.request('/login', nav))!.text()).toBe('shell');
  });

  test('no network and no shell is a network failure, as without a worker', async () => {
    const w = worker(noNetwork);
    await expect(w.request('/', nav)).rejects.toThrow(TypeError);
  });
});

describe('saves', () => {
  const path = '/api/save/sudoku';
  const put = (body: string) => ({ method: 'PUT', body, headers: { 'Content-Type': 'application/json' } });
  const keep = async (w: ReturnType<typeof worker>, response: Response) =>
    (await w.caches.open(SAVES)).put(path, response);

  test('a load from the server is kept, and passes through unmarked', async () => {
    const w = worker(() => ok('{"a":1}'));
    const answer = (await w.request(path))!;
    expect(await answer.text()).toBe('{"a":1}');
    expect(answer.headers.has(CACHED_HEADER)).toBe(false);
    expect(await w.caches.held(SAVES, path)!.text()).toBe('{"a":1}');
  });

  test('"no save" from the server is kept too', async () => {
    const w = worker(() => from(new Response(null, { status: 204 })));
    await w.request(path);
    expect(w.caches.held(SAVES, path)!.status).toBe(204);
  });

  test.each([
    ['a 401', () => from(new Response('{}', { status: 401 }))],
    ['a 500', () => from(new Response('', { status: 500 }))],
    ['a redirect', () => from(new Response('login'), { redirected: true })],
  ])('%s passes through and leaves the kept save alone', async (_name, answer) => {
    const response = answer();
    const w = worker(() => response);
    await keep(w, new Response('kept'));
    expect(await w.request(path)).toBe(response);
    expect(await w.caches.held(SAVES, path)!.text()).toBe('kept');
  });

  test('no network: the kept save, marked as cached; a kept "no save" too', async () => {
    const w = worker(noNetwork);
    await keep(w, new Response('{"a":1}', { headers: { 'Content-Type': 'application/json' } }));
    const answer = (await w.request(path))!;
    expect(await answer.text()).toBe('{"a":1}');
    expect(answer.headers.get(CACHED_HEADER)).toBe('1');
    expect(answer.headers.get('Content-Type')).toBe('application/json');

    await keep(w, new Response(null, { status: 204 }));
    const none = (await w.request(path))!;
    expect(none.status).toBe(204);
    expect(none.headers.get(CACHED_HEADER)).toBe('1');
  });

  test('no network and nothing kept fails as a network failure, not as "no save"', async () => {
    const w = worker(noNetwork);
    await expect(w.request(path)).rejects.toThrow(TypeError);
  });

  test('a save the server confirmed becomes the kept one', async () => {
    const w = worker(() => from(new Response(null, { status: 204 })));
    await keep(w, new Response('{"old":1}'));
    const answer = (await w.request(path, put('{"new":1}')))!;
    expect(answer.status).toBe(204);
    const kept = w.caches.held(SAVES, path)!;
    expect(kept.status).toBe(200);
    expect(await kept.text()).toBe('{"new":1}');
  });

  test.each([
    ['refused', () => from(new Response('{}', { status: 401 }))],
    ['too large', () => from(new Response('{}', { status: 413 }))],
  ])('a save the server %s is not on the device', async (_name, answer) => {
    const w = worker(answer);
    await keep(w, new Response('{"old":1}'));
    await w.request(path, put('{"new":1}'));
    expect(await w.caches.held(SAVES, path)!.text()).toBe('{"old":1}');
  });

  test('a save with no network fails as it would without a worker, and is not on the device', async () => {
    const w = worker(noNetwork);
    await keep(w, new Response('{"old":1}'));
    await expect(w.request(path, put('{"new":1}'))).rejects.toThrow(TypeError);
    expect(await w.caches.held(SAVES, path)!.text()).toBe('{"old":1}');
  });
});

describe('a connection that hangs', () => {
  const save = '/api/save/sudoku';
  const never = () => new Promise<Response>(() => {});
  const nav = { navigate: true };
  // A network whose answers the test gives by hand.
  function byHand() {
    const waiting: ((response: Response) => void)[] = [];
    return { waiting, network: () => new Promise<Response>((resolve) => waiting.push(resolve)) };
  }
  const seen = (answer: Promise<Response> | undefined) => {
    const state = { response: undefined as Response | undefined };
    void answer!.then((r) => (state.response = r));
    return state;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('a navigation falls back to the shell after 3 seconds, not before', async () => {
    const w = worker(never);
    await (await w.caches.open(APP)).put('/', new Response('shell'));
    const state = seen(w.send('/', nav).answer);
    await vi.advanceTimersByTimeAsync(2900);
    expect(state.response).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(await state.response!.text()).toBe('shell');
  });

  test('with no shell a navigation keeps waiting, so a slow link still loads', async () => {
    const hand = byHand();
    const w = worker(hand.network);
    const state = seen(w.send('/', nav).answer);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.response).toBeUndefined();
    hand.waiting[0](ok('late page'));
    await vi.advanceTimersByTimeAsync(0);
    expect(await state.response!.text()).toBe('late page');
  });

  test('a save load falls back to the kept save after 3 seconds, marked', async () => {
    const w = worker(never);
    await (await w.caches.open(SAVES)).put(save, new Response('{"kept":1}'));
    const state = seen(w.send(save).answer);
    await vi.advanceTimersByTimeAsync(2900);
    expect(state.response).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(await state.response!.text()).toBe('{"kept":1}');
    expect(state.response!.headers.get(CACHED_HEADER)).toBe('1');
  });

  test('with nothing kept a save load keeps waiting, past the page limit if it must', async () => {
    const hand = byHand();
    const w = worker(hand.network);
    const state = seen(w.send(save).answer);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.response).toBeUndefined();
    hand.waiting[0](ok('{"late":1}'));
    await vi.advanceTimersByTimeAsync(0);
    expect(await state.response!.text()).toBe('{"late":1}');
  });

  test('a late answer still updates the kept save', async () => {
    const hand = byHand();
    const w = worker(hand.network);
    await (await w.caches.open(SAVES)).put(save, new Response('{"old":1}'));
    const state = seen(w.send(save).answer);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await state.response!.text()).toBe('{"old":1}');
    hand.waiting[0](ok('{"late":1}'));
    await vi.advanceTimersByTimeAsync(0);
    expect(await w.caches.held(SAVES, save)!.text()).toBe('{"late":1}');
  });

  test('a late answer asked before a confirmed save does not replace that save', async () => {
    const hand = byHand();
    const w = worker(hand.network);
    await (await w.caches.open(SAVES)).put(save, new Response('{"old":1}'));
    w.send(save);
    await vi.advanceTimersByTimeAsync(3100);
    const put = w.send(save, { method: 'PUT', body: '{"new":1}' }).answer;
    await vi.advanceTimersByTimeAsync(0);
    hand.waiting[1](from(new Response(null, { status: 204 })));
    await put;
    hand.waiting[0](ok('{"late":1}'));
    await vi.advanceTimersByTimeAsync(0);
    expect(await w.caches.held(SAVES, save)!.text()).toBe('{"new":1}');
  });

  test('right after a timeout saves come from the device at once, so a reopen does not wait twice', async () => {
    const hand = byHand();
    const w = worker(hand.network);
    await (await w.caches.open(APP)).put('/', new Response('shell'));
    await (await w.caches.open(SAVES)).put(save, new Response('{"kept":1}'));
    w.send('/', nav);
    await vi.advanceTimersByTimeAsync(3100);
    const state = seen(w.send(save).answer);
    await vi.advanceTimersByTimeAsync(0);
    expect(await state.response!.text()).toBe('{"kept":1}');

    hand.waiting[0](ok('late page')); // a real answer: the link is back
    await vi.advanceTimersByTimeAsync(0);
    w.send(save);
    await vi.advanceTimersByTimeAsync(0);
    expect(hand.waiting).toHaveLength(2);
  });
});

describe('a gateway error while the site is being replaced', () => {
  const save = '/api/save/sudoku';
  const nav = { navigate: true };
  const gateway = (status: number) => () => from(new Response('bad gateway', { status }));

  test.each([502, 503, 504])('%i: a navigation gets the shell, a save load the kept save, marked', async (status) => {
    const w = worker(gateway(status));
    await (await w.caches.open(APP)).put('/', new Response('shell'));
    await (await w.caches.open(SAVES)).put(save, new Response('{"kept":1}'));
    expect(await (await w.request('/', nav))!.text()).toBe('shell');
    const answer = (await w.request(save))!;
    expect(await answer.text()).toBe('{"kept":1}');
    expect(answer.headers.get(CACHED_HEADER)).toBe('1');
  });

  test.each([502, 503, 504])('%i with nothing kept passes through', async (status) => {
    const w = worker(gateway(status));
    expect((await w.request('/', nav))!.status).toBe(status);
    expect((await w.request(save))!.status).toBe(status);
    expect(await w.caches.keys()).toEqual([]);
  });

  test.each([401, 403, 404, 500])('%i is the server talking: it passes through over a kept copy', async (status) => {
    const w = worker(gateway(status));
    await (await w.caches.open(APP)).put('/', new Response('shell'));
    await (await w.caches.open(SAVES)).put(save, new Response('{"kept":1}'));
    expect((await w.request('/', nav))!.status).toBe(status);
    expect((await w.request(save))!.status).toBe(status);
  });

  test('a redirect passes through over a kept shell', async () => {
    const redirect = from(new Response(null, { status: 200 }), { type: 'opaqueredirect' });
    const w = worker(() => redirect);
    await (await w.caches.open(APP)).put('/', new Response('shell'));
    expect(await w.request('/', nav)).toBe(redirect);
  });

  test('a save that met a gateway error is not on the device, and fails to the page', async () => {
    const w = worker(gateway(503));
    await (await w.caches.open(SAVES)).put(save, new Response('{"old":1}'));
    const answer = (await w.request(save, { method: 'PUT', body: '{"new":1}' }))!;
    expect(answer.status).toBe(503);
    expect(await w.caches.held(SAVES, save)!.text()).toBe('{"old":1}');
  });
});

describe('a tab left over after log out', () => {
  test.each([
    ['no network', noNetwork],
    ['a 401', () => from(new Response('{}', { status: 401 }))],
  ])('with %s, a save load or a save creates no cache', async (_name, network) => {
    const w = worker(network);
    await w.request('/api/save/sudoku').catch(() => {});
    await w.request('/api/save/sudoku', { method: 'PUT', body: '{}' }).catch(() => {});
    expect(await w.caches.keys()).toEqual([]);
  });
});

describe('told that a log out has started', () => {
  const save = { method: 'PUT', body: '{"moves":1}' };

  test('a save answer landing after that puts nothing back', async () => {
    const answers: ((response: Response) => void)[] = [];
    const w = worker(() => new Promise((resolve) => answers.push(resolve)));
    const loading = w.request('/api/save/sudoku');
    const storing = w.request('/api/save/sudoku', save);
    await vi.waitFor(() => expect(w.fetchIt).toHaveBeenCalledTimes(2));
    await w.told();
    answers.forEach((answer) => answer(ok('{"moves":1}')));
    await Promise.allSettled([loading, storing]);
    expect(await w.caches.keys()).toEqual([]);
  });

  test('later loads and saves pass through, and keep nothing', async () => {
    const w = worker(() => ok('{"moves":2}'));
    await w.told();
    expect(await (await w.request('/api/save/sudoku'))!.text()).toBe('{"moves":2}');
    expect((await w.request('/api/save/sudoku', save))!.ok).toBe(true);
    expect(await w.caches.keys()).toEqual([]);
  });

  test('it answers only when the write under way is done', async () => {
    const w = worker(() => ok());
    const realOpen = w.caches.open;
    let letOpen = () => {};
    w.caches.open = (name) => new Promise((resolve) => (letOpen = () => resolve(realOpen(name))));
    const storing = w.request('/api/save/sudoku', save);
    await vi.waitFor(() => expect(w.fetchIt).toHaveBeenCalled());
    let answered = false;
    const telling = w.told().then(() => (answered = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(answered).toBe(false);
    letOpen();
    await telling;
    await storing;
    expect(answered).toBe(true);
  });
});

describe('keeping saves', () => {
  test('writes land in order: a slow older write cannot replace a newer one', async () => {
    const w = worker(() => ok());
    const realOpen = w.caches.open;
    let calls = 0;
    let letFirst = () => {};
    w.caches.open = async (name) => {
      calls += 1;
      if (calls === 1) await new Promise<void>((resolve) => (letFirst = resolve));
      return realOpen(name);
    };
    const older = w.request('/api/save/sudoku', { method: 'PUT', body: 'older' });
    await vi.waitFor(() => expect(calls).toBe(1));
    const newer = w.request('/api/save/sudoku', { method: 'PUT', body: 'newer' });
    await new Promise((r) => setTimeout(r, 20));
    letFirst();
    await Promise.all([older, newer]);
    expect(await w.caches.held(SAVES, '/api/save/sudoku')!.text()).toBe('newer');
  });

  test('a failed write does not stop the next one', async () => {
    const w = worker(() => ok());
    const realOpen = w.caches.open;
    w.caches.open = async () => {
      w.caches.open = realOpen;
      throw new Error('quota');
    };
    await expect(w.request('/api/save/sudoku', { method: 'PUT', body: 'lost' })).rejects.toThrow('quota');
    await w.request('/api/save/sudoku', { method: 'PUT', body: 'kept' });
    expect(await w.caches.held(SAVES, '/api/save/sudoku')!.text()).toBe('kept');
  });
});

describe('what the worker leaves alone', () => {
  test.each([
    ['/logout', { method: 'POST' }],
    ['/login', { method: 'POST', navigate: true }],
    ['/api/new/sudoku', { method: 'POST' }],
    ['/login.css', {}],
    ['/fonts/x.woff2', {}],
    ['/assets/an-older-bundle.js', {}],
    ['https://elsewhere.test/api/save/sudoku', {}],
  ])('%s', async (path, init) => {
    const w = worker(() => ok());
    expect(await w.request(path, init)).toBeUndefined();
    expect(w.fetchIt).not.toHaveBeenCalled();
  });
});

describe('assets', () => {
  test('come from the cache first, and from the network if the cache lost them', async () => {
    const w = worker(() => ok('network'));
    expect(await (await w.request(ASSET))!.text()).toBe('network');
    await (await w.caches.open(APP)).put(ASSET, new Response('kept'));
    expect(await (await w.request(ASSET))!.text()).toBe('kept');
  });
});

describe('in the page', () => {
  function device({ serviceWorker = true } = {}) {
    const order: string[] = [];
    const unregister = vi.fn(async () => {
      order.push('unregister');
      return true;
    });
    const remove = vi.fn(async (name: string) => {
      order.push(`delete ${name}`);
      return true;
    });
    const register = vi.fn(async () => ({}));
    vi.stubGlobal('caches', { keys: async () => ['a', 'b'], delete: remove });
    vi.stubGlobal('navigator', {
      serviceWorker: serviceWorker
        ? { register, getRegistrations: async () => [{ unregister }, { unregister }] }
        : undefined,
    });
    return { order, unregister, remove, register };
  }

  test('clearDevice stops the worker, then removes every cache', async () => {
    const { order, unregister, remove } = device();
    await clearDevice();
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls.map(([name]) => name)).toEqual(['a', 'b']);
    expect(order.slice(0, 2)).toEqual(['unregister', 'unregister']);
  });

  test('clearDevice tells each worker first, and waits for its answer', async () => {
    const { order, unregister } = device();
    const post = vi.fn((_message: unknown, ports: MessagePort[]) => {
      order.push('told');
      ports[0].postMessage('done');
    });
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistrations: async () => [{ active: { postMessage: post }, unregister }] },
    });
    await clearDevice();
    expect(post.mock.calls[0][0]).toEqual({ type: 'logging-out' });
    expect(order.slice(0, 2)).toEqual(['told', 'unregister']);
  });

  test('a worker that never answers does not stop clearDevice', async () => {
    const { unregister, remove } = device();
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistrations: async () => [{ active: { postMessage: () => {} }, unregister }] },
    });
    await clearDevice();
    expect(unregister).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  test('clearDevice carries on past a failure and never throws', async () => {
    const { remove, unregister } = device();
    unregister.mockRejectedValueOnce(new Error('no'));
    remove.mockRejectedValueOnce(new Error('no'));
    await expect(clearDevice()).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(2);
  });

  test('clearDevice works where there is no worker or cache', async () => {
    device({ serviceWorker: false });
    vi.stubGlobal('caches', undefined);
    await expect(clearDevice()).resolves.toBeUndefined();
  });

  test('the worker registers once at the root, and a failure stays quiet', async () => {
    const { register } = device();
    vi.stubGlobal('window', { addEventListener: (_: string, run: () => void) => run() });
    register.mockRejectedValueOnce(new Error('offline'));
    registerWorker();
    await Promise.resolve();
    expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js');
  });

  test('where the browser has no workers, registering does nothing', () => {
    device({ serviceWorker: false });
    expect(() => registerWorker()).not.toThrow();
  });
});
