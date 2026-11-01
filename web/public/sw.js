// Keeps the app and the last save the server confirmed on this device, so a game loaded
// once stays playable with no connection. Only "no network" reaches the cache: any answer
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

// The first page asked for its saves before this worker could see them.
async function fetchMissingSaves() {
  const cache = await caches.open(SAVES_CACHE);
  await Promise.allSettled(
    GAMES.map(async (game) => {
      const url = `/api/save/${game}`;
      if (await cache.match(url)) return;
      const response = await fetch(url);
      if (worthKeeping(response)) await cache.put(url, response);
    }),
  );
}

async function removeOldCaches() {
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n !== APP_CACHE && n !== SAVES_CACHE).map((n) => caches.delete(n)));
}

async function navigate(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const shell = await caches.match(SHELL);
    if (shell) return shell;
    throw error;
  }
}

async function loadSave(request) {
  const cache = await caches.open(SAVES_CACHE);
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const kept = await cache.match(request.url);
    if (!kept) throw error; // a network failure, never "no saved game"
    const headers = new Headers(kept.headers);
    headers.set(CACHED_HEADER, '1');
    return new Response(kept.body, { status: kept.status, statusText: kept.statusText, headers });
  }
  if (worthKeeping(response)) await cache.put(request.url, response.clone());
  return response;
}

// Kept only once the server has confirmed it, before the page hears that it has.
async function storeSave(request) {
  const body = await request.clone().text();
  const response = await fetch(request);
  if (worthKeeping(response)) {
    const cache = await caches.open(SAVES_CACHE);
    await cache.put(request.url, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
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
    event.respondWith(loadSave(request));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(asset(request));
  }
});
