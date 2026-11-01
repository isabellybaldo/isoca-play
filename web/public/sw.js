// Keeps the app and the last save the server confirmed on this device, so a game loaded
// once stays playable with no connection. Only "no network" reaches the cache: a failure,
// a link that does not answer in time, or a gateway saying the server is away. Any answer
// from the server, a redirect to /login or a 401 included, passes through as it is.
//
// The build replaces these two values (see the plugin in vite.config.ts).
const VERSION = '__SW_VERSION__';
const ASSETS = ['__SW_ASSETS__'];

const APP_CACHE = `isoca-play-app-${VERSION}`;
const SAVES_CACHE = 'isoca-play-saves'; // not per version: the saves outlive a release
const SHELL = '/';
const GAMES = ['mahjong', 'sudoku'];
const SAVE_PATH = /^\/api\/save\/[^/]+$/;
const CACHED_HEADER = 'X-Isoca-Cached'; // how the page tells a kept save from the server's
const WAIT_FOR_NETWORK = 3000; // well under the 10 seconds after which the page gives up
const STAY_ON_KEPT = 5000; // after a timeout, how long saves skip the network
const LATE_LIMIT = 30_000;
const NOT_REACHED = new Set([502, 503, 504]);

let noAnswerUntil = 0;
let tickets = 0;
const keptTicket = new Map();

// A redirect or the login page must never be kept as the app or as a save.
const worthKeeping = (response) => response.ok && !response.redirected && response.type === 'basic';

async function precache() {
  const urls = [SHELL, ...ASSETS];
  // All fetched before any is stored: a failed install leaves nothing behind.
  const responses = await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!worthKeeping(response)) throw new Error(`Not kept: ${url}`);
      return response;
    }),
  );
  const cache = await caches.open(APP_CACHE);
  await Promise.all(urls.map((url, i) => cache.put(url, responses[i])));
}

// Opened only to store: a tab left over after log out must not recreate an empty cache.
// A ticket is taken when a load starts and when a save is confirmed, so a late answer to
// an older question cannot replace something newer.
async function keepSave(url, ticket, response) {
  if (ticket < (keptTicket.get(url) ?? 0)) return;
  keptTicket.set(url, ticket);
  const cache = await caches.open(SAVES_CACHE);
  await cache.put(url, response);
}

async function keptSave(url) {
  const kept = await caches.match(url, { cacheName: SAVES_CACHE });
  if (!kept) return undefined;
  const headers = new Headers(kept.headers);
  headers.set(CACHED_HEADER, '1');
  return new Response(kept.body, { status: kept.status, statusText: kept.statusText, headers });
}

// The first page asked for its saves before this worker could see them.
async function fetchMissingSaves() {
  await Promise.allSettled(
    GAMES.map(async (game) => {
      const url = `/api/save/${game}`;
      if (await caches.match(url, { cacheName: SAVES_CACHE })) return;
      const ticket = ++tickets;
      const response = await fetch(url);
      if (worthKeeping(response)) await keepSave(url, ticket, response);
    }),
  );
}

async function removeOldCaches() {
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n !== APP_CACHE && n !== SAVES_CACHE).map((n) => caches.delete(n)));
}

// The network, unless it fails, hangs or only a gateway answers, and a kept copy exists.
// With nothing kept, whatever the network does is the answer, however slow.
function networkOrKept(network, kept) {
  return new Promise((resolve, reject) => {
    const fallBack = async (otherwise) => {
      const copy = await kept();
      if (copy) resolve(copy);
      else otherwise();
    };
    const timer = setTimeout(() => {
      noAnswerUntil = Date.now() + STAY_ON_KEPT;
      void fallBack(() => {});
    }, WAIT_FOR_NETWORK);
    network.then(
      (response) => {
        clearTimeout(timer);
        if (NOT_REACHED.has(response.status)) {
          void fallBack(() => resolve(response));
          return;
        }
        noAnswerUntil = 0;
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        void fallBack(() => reject(error));
      },
    );
  });
}

function navigate(request) {
  return networkOrKept(fetch(request), () => caches.match(SHELL));
}

async function loadSave(event) {
  const { request } = event;
  const { url } = request;
  // The link just hung, so a reopen does not wait a second time for each save.
  if (Date.now() < noAnswerUntil) {
    const copy = await keptSave(url);
    if (copy) return copy;
  }
  const ticket = ++tickets;
  // Past a fallback this request runs on by itself, to update the kept copy. It must end
  // some time: hung requests would use up the browser's connections.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(LATE_LIMIT)]);
  const network = fetch(request, { signal }).then(async (response) => {
    if (worthKeeping(response)) await keepSave(url, ticket, response.clone());
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  return networkOrKept(network, () => keptSave(url));
}

// Kept only once the server has confirmed it, before the page hears that it has.
async function storeSave(request) {
  const body = await request.clone().text();
  const response = await fetch(request);
  if (!NOT_REACHED.has(response.status)) noAnswerUntil = 0;
  if (worthKeeping(response)) {
    const kept = new Response(body, { headers: { 'Content-Type': 'application/json' } });
    await keepSave(request.url, ++tickets, kept);
  }
  return response;
}

async function asset(request) {
  return (await caches.match(request.url)) ?? fetch(request);
}

self.addEventListener('install', (event) => {
  // Taking over at once is safe: a page on an older bundle keeps what it has loaded, and
  // its files stay in the HTTP cache. Nothing here reloads a page; the next load is new.
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    removeOldCaches()
      .then(fetchMissingSaves)
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isSave = SAVE_PATH.test(url.pathname);
  if (request.method === 'PUT' && isSave) {
    event.respondWith(storeSave(request));
  } else if (request.method !== 'GET') {
    return;
  } else if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
  } else if (isSave) {
    event.respondWith(loadSave(event));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(asset(request));
  }
});
