// The spec's offline table, in real Chrome against the real server. Run it by hand:
//
//   node web/e2e/offline.mjs
//
// Needs server/.venv, installed Chrome and openssl (Git for Windows has one). It makes
// two real builds, a temp database and a throwaway certificate in the system temp folder
// and leaves nothing behind. Being offline here means both: Playwright's offline switch,
// which is what navigator.onLine sees, and the server process stopped, so that nothing
// can answer past the switch. The real server is wrapped only to add the production CSP.
//
// Chrome trusts the throwaway certificate through --ignore-certificate-errors-spki-list.
// The context's ignoreHTTPSErrors is not enough, even on localhost: the worker never takes
// the page (seen on Chrome 156). --ignore-certificate-errors would do for the worker, but
// Chrome then keeps nothing in its HTTP cache, and the log out checks would prove nothing.
// The server and the app need no dev setting.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from 'vite';

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER = join(WEB, '..', 'server');
const PASSWORD = 'a throwaway password for this run';
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; connect-src 'self'; " +
  "font-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const WAIT = 8000;
const SAVES = 'isoca-play-saves';

const results = [];
let failures = 0;
async function check(name, run) {
  try {
    await run();
    results.push(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    results.push(`FAIL  ${name}\n      ${String(error.message ?? error).split('\n').slice(0, 3).join('\n      ')}`);
  }
  console.log(results.at(-1));
}
function same(actual, expected, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: got ${a}, wanted ${e}`);
}
function yes(value, what) {
  if (!value) throw new Error(what);
}
// For answers that need an await inside the page.
async function until(ask, what, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!(await ask())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const temp = mkdtempSync(join(tmpdir(), 'isoca-play-e2e-'));
const site = join(temp, 'site');
const python = [join(SERVER, '.venv', 'Scripts', 'python.exe'), join(SERVER, '.venv', 'bin', 'python')].find(existsSync);
if (!python) throw new Error('server/.venv is missing');

const openssl =
  ['C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'].find(existsSync) ??
  'openssl';
const env = { ...process.env, DB_PATH: join(temp, 'play.db'), STATIC_DIR: site, APP_VERSION: 'e2e' };

function prepare() {
  execFileSync(
    openssl,
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost',
      '-keyout', join(temp, 'key.pem'), '-out', join(temp, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    python,
    [
      '-c',
      `
import os
from argon2 import PasswordHasher
from isoca_play import db
conn = db.connect(os.environ['DB_PATH'])
conn.execute('INSERT INTO account (id, password_hash) VALUES (1, ?)', (PasswordHasher().hash(${JSON.stringify(PASSWORD)}),))
conn.close()
`,
    ],
    { env, cwd: SERVER },
  );
  writeFileSync(
    join(temp, 'run_server.py'),
    `
import sys, uvicorn
from isoca_play.app import create_app
from isoca_play.config import from_env
app = create_app(from_env())
async def with_csp(scope, receive, send):
    async def sending(message):
        if message["type"] == "http.response.start":
            message.setdefault("headers", []).append((b"content-security-policy", ${JSON.stringify(CSP)}.encode()))
        await send(message)
    await app(scope, receive, sending)
uvicorn.run(with_csp, host="127.0.0.1", port=int(sys.argv[1]), ssl_keyfile=sys.argv[2], ssl_certfile=sys.argv[3], log_level="info")
`,
  );
}

const port = await new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const BASE = `https://localhost:${port}`;

// The server log is how the checks count what truly reached the server.
let serverLog = '';
let serverProcess = null;
const putsSeen = (game) => (serverLog.match(new RegExp(`"PUT /api/save/${game} `, 'g')) ?? []).length;

function up() {
  return new Promise((resolve) => {
    https
      .get(`${BASE}/healthz`, { rejectUnauthorized: false, agent: false }, (r) => {
        r.resume();
        resolve(r.statusCode === 200);
      })
      .on('error', () => resolve(false));
  });
}
async function startServer() {
  serverProcess = spawn(python, ['-u', join(temp, 'run_server.py'), String(port), join(temp, 'key.pem'), join(temp, 'cert.pem')], {
    env,
    cwd: SERVER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (d) => (serverLog += d));
  serverProcess.stderr.on('data', (d) => (serverLog += d));
  for (let i = 0; i < 100; i += 1) {
    if (await up()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the server did not start:\n${serverLog}`);
}
// By this run's own PID. On Windows a venv's python.exe is a launcher with the real
// python as its child, so the tree under that PID goes, and nothing else.
async function stopServer() {
  const running = serverProcess;
  if (!running) return;
  serverProcess = null;
  const gone = new Promise((resolve) => running.once('exit', resolve));
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(running.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  } else {
    running.kill();
  }
  await gone;
  for (let i = 0; i < 50 && (await up()); i += 1) await new Promise((r) => setTimeout(r, 100));
}

async function buildRelease(name, marker) {
  const outDir = join(temp, name);
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  await build({
    root: WEB,
    logLevel: 'silent',
    mode: 'production',
    build: { outDir, emptyOutDir: true },
    plugins: marker
      ? [
          {
            name: 'e2e-release',
            enforce: 'pre',
            transform: (code, id) =>
              id.replaceAll('\\', '/').endsWith('src/main.tsx')
                ? `${code}\nglobalThis.__isocaRelease = ${JSON.stringify(marker)};\n`
                : undefined,
          },
        ]
      : [],
  });
  process.env.NODE_ENV = before;
  return outDir;
}
function publish(release) {
  rmSync(site, { recursive: true, force: true });
  cpSync(release, site, { recursive: true });
}

let browser;
// A navigation Chrome has lost can leave a page call waiting for ever. Closing the browser
// ends those calls, so a stuck run fails and cleans up.
const watchdog = setTimeout(() => {
  failures += 1;
  console.log('FAIL  the run took over 10 minutes');
  browser?.close().catch(() => {});
}, 600_000);
try {
  prepare();
  const releaseA = await buildRelease('release-a');
  const releaseB = await buildRelease('release-b', 'B');
  publish(releaseA);
  await startServer();

  const spki = new X509Certificate(readFileSync(join(temp, 'cert.pem'))).publicKey.export({ type: 'spki', format: 'der' });
  const pin = createHash('sha256').update(spki).digest('base64');
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [`--ignore-certificate-errors-spki-list=${pin}`],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  context.setDefaultTimeout(WAIT);
  const page = await context.newPage();
  const violations = [];
  const watch = (p) =>
    p.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
  watch(page);

  const goOffline = async () => {
    await context.setOffline(true);
    await stopServer();
  };
  const goOnline = async () => {
    await startServer();
    await context.setOffline(false);
  };

  const button = (p, name) => p.getByRole('button', { name, exact: typeof name === 'string' });
  const marker = (p) => p.locator('.save-marker');
  const cacheNames = (p = page) => p.evaluate(() => caches.keys());
  const workers = (p = page) => p.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  const held = (game, p = page) =>
    p.evaluate(
      async ([name, path]) => {
        const r = await (await caches.open(name)).match(path);
        return r ? { status: r.status, text: await r.text() } : null;
      },
      [SAVES, `/api/save/${game}`],
    );
  const heldMoves = async (game, p = page) => JSON.parse((await held(game, p)).text).history.length;
  const serverSave = (game, p = page) =>
    p.evaluate(async (path) => {
      const r = await fetch(path, { cache: 'no-store' });
      return { status: r.status, cached: r.headers.has('X-Isoca-Cached'), body: r.status === 200 ? await r.json() : null };
    }, `/api/save/${game}`);
  const waitWorker = async (p = page) => {
    await p.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
    await until(async () => (await held('sudoku', p)) && (await held('mahjong', p)), 'the saves are kept');
  };
  const reload = (p = page) => p.reload({ waitUntil: 'load' });
  const home = (p = page) => p.getByRole('heading', { name: 'isoca play' }).waitFor();
  const board = (p) => p.getByRole('group', { name: 'Board' });
  // A wrong digit is still a move: this checks saving, not solving.
  const play = async (p, digit) => {
    await board(p).getByRole('button', { name: /, empty$/ }).first().click();
    await p.getByRole('group', { name: 'Numbers' }).getByRole('button', { name: digit, exact: true }).click();
  };
  const saved = (p, game = 'sudoku') => {
    const response = p.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().endsWith(`/api/save/${game}`) && r.status() === 204,
    );
    response.catch(() => {}); // a timeout fails its check where it is awaited, not the run
    return response;
  };
  const noMarker = (p = page, timeout = 15000) =>
    p.waitForFunction(() => !document.querySelector('.save-marker'), null, { timeout });

  console.log('-- a browser with no session');
  await check('a load with no session lands on /login, and registers and keeps nothing', async () => {
    await page.goto('/');
    same(new URL(page.url()).pathname, '/login', 'path');
    same(await workers(), 0, 'workers');
    same(await cacheNames(), [], 'caches');
  });

  console.log('-- log in, load once');
  await page.getByLabel('password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await home();
  await check('the worker registers after login, takes the page and keeps the shell', async () => {
    await waitWorker();
    const names = await cacheNames();
    yes(names.some((n) => n.startsWith('isoca-play-app-')), `no app cache in ${names}`);
    const shell = await page.evaluate(async () => (await caches.match('/')).text());
    yes(shell.includes('id="root"'), 'the kept shell is not the app');
    yes(!shell.includes('type="password"'), 'the kept shell is the login page');
  });

  await button(page, /Sudoku/).click();
  let putting = saved(page);
  await button(page, 'Easy').click();
  await putting;
  await board(page).waitFor();
  putting = saved(page);
  await play(page, '5');
  await putting;
  await button(page, 'Back to levels').click();
  await button(page, 'Back to home').click();
  await button(page, /Mahjong/).click();
  putting = saved(page, 'mahjong');
  await button(page, /^Frame/).click();
  await putting;
  await board(page).waitFor();
  await button(page, 'Back to setup').click();
  await button(page, 'Back to home').click();

  await check('the kept save is the one the server confirmed', async () => {
    same(await heldMoves('sudoku'), 1, 'moves kept');
    same((await serverSave('sudoku')).body, JSON.parse((await held('sudoku')).text), 'against the server');
  });

  console.log('-- load once, go offline, reload');
  await goOffline();
  await check('reload offline: the app comes from the cache, with the marker', async () => {
    await reload();
    await home();
    yes(/Offline/.test(await marker(page).textContent()), 'no marker');
  });
  await check('reload offline: sudoku resumes from the last save', async () => {
    await button(page, /Sudoku/).click();
    await button(page, 'Resume Easy, 1 move').waitFor();
  });
  await check('new game offline: levels disabled, with the note', async () => {
    yes(await button(page, 'Easy').isDisabled(), 'Easy is enabled');
    await page.getByText('New games need a connection.').waitFor();
  });
  await check('offline it plays: a move lands, and the marker stays', async () => {
    await button(page, 'Resume Easy, 1 move').click();
    const before = await board(page).getByRole('button', { name: /, written / }).count();
    await play(page, '6');
    await page.waitForFunction(
      (n) => document.querySelectorAll('.sd-board button[aria-label*="written"]').length === n,
      before + 1,
    );
    yes(/Offline/.test(await marker(page).textContent()), 'no marker');
  });
  await check('new game inside the game is disabled too', async () => {
    yes(await button(page, 'New game').isDisabled(), 'New game is enabled');
  });
  await check('the unsaved offline move is not on the device', async () => {
    same(await heldMoves('sudoku'), 1, 'moves kept');
  });
  await check('page closed while offline: moves since the last save are lost', async () => {
    await reload();
    await button(page, /Sudoku/).click();
    await button(page, 'Resume Easy, 1 move').waitFor();
  });
  await check('mahjong resumes offline too, tiles and all', async () => {
    await button(page, 'Back to home').click();
    await button(page, /Mahjong/).click();
    await button(page, /^Resume Frame/).click();
    yes((await board(page).getByRole('button').count()) > 0, 'no tiles');
    await button(page, 'Back to setup').click();
    yes(await button(page, /^Frame/).isDisabled(), 'a new deal is enabled offline');
    await button(page, 'Back to home').click();
  });
  await check('log out offline: disabled, with the note', async () => {
    yes(await button(page, 'Log out').isDisabled(), 'Log out is enabled');
    await page.getByText('Logging out needs a connection.').waitFor();
  });
  await check('log in offline: not offered, /login shows the app and the marker', async () => {
    await page.goto('/login');
    await home();
    same(await page.getByLabel('password').count(), 0, 'password fields');
    yes(/Offline/.test(await marker(page).textContent()), 'no marker');
  });
  await check('nothing kept for a game offline is not "no saved game": it waits, and writes nothing', async () => {
    await page.evaluate(async (name) => (await caches.open(name)).delete('/api/save/sudoku'), SAVES);
    await reload();
    await button(page, /Sudoku/).click();
    await page.getByText('New games need a connection.').waitFor();
    same(await page.getByRole('button', { name: /^Resume/ }).count(), 0, 'resume buttons');
    yes(await button(page, 'Easy').isDisabled(), 'Easy is enabled');
  });

  console.log('-- back online with the page open');
  const putsBefore = putsSeen('sudoku');
  await check('a page with nothing to send writes nothing on coming back, and picks up the save', async () => {
    await goOnline();
    await button(page, 'Resume Easy, 1 move').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await noMarker();
    same(putsSeen('sudoku'), putsBefore, 'PUTs reaching the server');
  });
  await check('the kept save is back on the device', async () => {
    same(await heldMoves('sudoku'), 1, 'moves kept');
  });
  await check('a reload offline and online again, with no move, writes nothing', async () => {
    await goOffline();
    await reload();
    await home();
    await goOnline();
    await page.waitForTimeout(1500);
    await noMarker();
    same(putsSeen('sudoku'), putsBefore, 'PUTs reaching the server');
  });
  await check('moves made offline with the page open reach the server on return', async () => {
    await reload();
    await button(page, /Sudoku/).click();
    await button(page, 'Resume Easy, 1 move').click();
    await goOffline();
    await play(page, '7');
    await marker(page).waitFor();
    await goOnline();
    await noMarker(page, 40000);
    same((await serverSave('sudoku')).body.history.length, 2, 'moves on the server');
    same(await heldMoves('sudoku'), 2, 'moves kept');
    same(putsSeen('sudoku'), putsBefore + 1, 'PUTs reaching the server');
  });

  console.log('-- the server gone while the browser still says online');
  await stopServer();
  await check('reload: the shell and the kept save, with the marker though navigator.onLine is true', async () => {
    await reload();
    same(await page.evaluate(() => navigator.onLine), true, 'onLine');
    await home();
    await marker(page).waitFor();
    yes(/Offline/.test(await marker(page).textContent()), 'marker text');
    await button(page, /Sudoku/).click();
    await button(page, 'Resume Easy, 2 moves').waitFor();
    await button(page, 'Back to home').click();
  });

  console.log('-- a connection that hangs: accepted, and never answered');
  const hanging = new Set();
  const hangingListener = net.createServer((socket) => {
    hanging.add(socket);
    socket.on('error', () => {});
  });
  await new Promise((resolve) => hangingListener.listen(port, '127.0.0.1', resolve));
  await check('reopen shows the game in about 3 seconds, with the marker', async () => {
    const started = Date.now();
    await reload();
    await home();
    await button(page, /Sudoku/).click();
    await button(page, 'Resume Easy, 2 moves').waitFor();
    const took = Date.now() - started;
    console.log(`      reopen took ${took} ms`);
    yes(took < 5000, `took ${took} ms`);
    yes(/Offline/.test(await marker(page).textContent()), 'marker text');
  });
  await check('moves respond immediately on the hanging connection', async () => {
    await button(page, 'Resume Easy, 2 moves').click();
    const before = await board(page).getByRole('button', { name: /, written / }).count();
    await board(page).getByRole('button', { name: /, empty$/ }).first().click();
    const started = Date.now();
    await page.getByRole('group', { name: 'Numbers' }).getByRole('button', { name: '3', exact: true }).click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('.sd-board button[aria-label*="written"]').length === n,
      before + 1,
    );
    const took = Date.now() - started;
    console.log(`      the move took ${took} ms`);
    yes(took < 1000, `took ${took} ms`);
  });
  await check('when the real server returns, the latest state saves', async () => {
    for (const socket of hanging) socket.destroy();
    await new Promise((resolve) => hangingListener.close(resolve));
    await startServer();
    await noMarker(page, 45000);
    same((await serverSave('sudoku')).body.history.length, 3, 'moves on the server');
    same(await heldMoves('sudoku'), 3, 'moves kept');
  });

  console.log('-- a deploy: the gateway answers 503');
  await stopServer();
  const gateway = https.createServer(
    { key: readFileSync(join(temp, 'key.pem')), cert: readFileSync(join(temp, 'cert.pem')) },
    (_request, response) => {
      response.writeHead(503, { 'Content-Type': 'text/plain' });
      response.end('deploying');
    },
  );
  await new Promise((resolve) => gateway.listen(port, '127.0.0.1', resolve));
  await check('a page reopened during a deploy shows the cached app and game, with the marker', async () => {
    await reload();
    await home();
    await marker(page).waitFor();
    yes(/Offline/.test(await marker(page).textContent()), 'marker text');
    await button(page, /Sudoku/).click();
    await button(page, 'Resume Easy, 3 moves').waitFor();
    yes(!(await page.content()).includes('deploying'), 'the gateway page is showing');
  });
  gateway.closeAllConnections();
  await new Promise((resolve) => gateway.close(resolve));
  await startServer();
  await check('after the deploy the marker clears, and nothing was written', async () => {
    const puts = putsSeen('sudoku');
    await noMarker(page, 45000);
    same(putsSeen('sudoku'), puts, 'PUTs reaching the server');
  });

  console.log('-- online with no session');
  const cookies = await context.cookies();
  await check('a navigation reaches /login though the worker holds the shell', async () => {
    await reload();
    await home();
    await context.clearCookies();
    await page.goto('/');
    same(new URL(page.url()).pathname, '/login', 'path');
    await page.getByLabel('password').waitFor();
    const names = await cacheNames();
    yes(names.some((n) => n.startsWith('isoca-play-app-')), 'the expired session cleared the device');
  });
  await check('the login page and the redirect were not kept as the shell, or as a save', async () => {
    const shell = await page.evaluate(async () => (await caches.match('/')).text());
    yes(shell.includes('id="root"') && !shell.includes('type="password"'), 'the shell was replaced');
    same(await heldMoves('sudoku'), 3, 'moves kept');
  });
  await context.addCookies(cookies);
  await check('an API 401 keeps its flow: the marker, the game in memory, and it saves after logging in', async () => {
    await page.goto('/');
    await button(page, /Sudoku/).click();
    await button(page, 'Resume Easy, 3 moves').click();
    await context.clearCookies();
    await play(page, '8');
    await page.getByRole('link', { name: 'Log in' }).waitFor({ timeout: 15000 });
    await context.addCookies(cookies);
    await noMarker(page, 40000);
    same((await serverSave('sudoku')).body.history.length, 4, 'moves on the server');
    same(await heldMoves('sudoku'), 4, 'moves kept');
  });

  console.log('-- a new release');
  await page.goto('/');
  await home();
  const oldPage = await context.newPage();
  watch(oldPage);
  await oldPage.goto('/');
  await home(oldPage);
  await waitWorker(oldPage);
  await oldPage.evaluate(() => {
    globalThis.__stillThisPage = true;
  });
  const version = (p = page) =>
    p.evaluate(async () => /const VERSION = '(\w+)'/.exec(await (await fetch('/sw.js')).text())?.[1]);
  const oldVersion = await version();
  publish(releaseB);
  const stillOld = (p) => p.evaluate(() => globalThis.__stillThisPage === true && !globalThis.__isocaRelease);

  await check('an open page on the old bundle is not reloaded, and still saves', async () => {
    await button(oldPage, /Sudoku/).click();
    await button(oldPage, 'Resume Easy, 4 moves').click();
    const put = saved(oldPage);
    await play(oldPage, '9');
    await put;
    same(await stillOld(oldPage), true, 'old page');
  });
  await check('the next online load runs the new version', async () => {
    await page.bringToFront();
    await reload();
    await home();
    same(await page.evaluate(() => globalThis.__isocaRelease), 'B', 'release');
  });
  const newVersion = await version();
  await check('the new worker takes over, and old caches are removed', async () => {
    yes(newVersion && newVersion !== oldVersion, 'the version did not change');
    const wanted = JSON.stringify([`isoca-play-app-${newVersion}`, SAVES].sort());
    await until(async () => JSON.stringify((await cacheNames()).sort()) === wanted, `caches are ${wanted}`);
  });
  await check('the page on the old bundle keeps working under the new worker, not reloaded', async () => {
    await oldPage.bringToFront();
    await until(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting === null), 'no worker is waiting');
    const put = saved(oldPage);
    await play(oldPage, '1');
    await put;
    same(await stillOld(oldPage), true, 'old page');
    same((await serverSave('sudoku', oldPage)).body.history.length, 6, 'moves on the server');
  });
  await check('the saves survived the release', async () => {
    same(await heldMoves('sudoku'), 6, 'moves kept');
  });
  await check('offline after the release, a reload runs the new version', async () => {
    await page.bringToFront();
    await goOffline();
    try {
      await reload();
      await home();
      same(await page.evaluate(() => globalThis.__isocaRelease), 'B', 'release');
      await button(page, /Sudoku/).click();
      await button(page, 'Resume Easy, 6 moves').waitFor();
      await button(page, 'Back to home').click();
      same(await stillOld(oldPage), true, 'old page');
    } finally {
      // A failure here must not leave the rest of the run offline: the log out checks
      // would then fail too, and look like a log out bug.
      await goOnline();
    }
    await noMarker();
  });
  await oldPage.close();

  console.log('-- a log out left unconfirmed');
  const UNCONFIRMED = 'Log out could not be confirmed, you are still signed in.';
  // The answer held past the 3 s patience, then lost as a 500. `reach` says whether the
  // server takes the log out first. Its real answer never gets to the page.
  const logoutLost = async (reach) => {
    const lost = new Promise((resolve, reject) => {
      context
        .route('**/logout', async (route) => {
          if (reach) await route.fetch({ maxRedirects: 0 });
          await new Promise((r) => setTimeout(r, 3300));
          await route.fulfill({ status: 500 });
          resolve();
        })
        .catch(reject);
    });
    await button(page, 'Log out').click();
    await lost;
    await context.unroute('**/logout');
  };
  await page.goto('/');
  await home();
  await waitWorker();
  await check('a failed log out past the patience lands in the app, signed in, and says so once', async () => {
    await logoutLost(false);
    await page.getByText(UNCONFIRMED).waitFor({ timeout: 15000 });
    same(new URL(page.url()).pathname, '/', 'path');
    await reload();
    await home();
    same(await page.getByText(UNCONFIRMED).count(), 0, 'the message after a reload');
    await waitWorker();
  });
  await check('a log out the server took but never confirmed: login, and no false message after it', async () => {
    await logoutLost(true);
    await page.getByLabel('password').waitFor({ timeout: 15000 });
    await page.getByLabel('password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await home();
    await page.waitForFunction(() => sessionStorage.getItem('isoca-play-logout-unconfirmed') === null);
    same(new URL(page.url()).hash, '', 'the mark in the address');
    await waitWorker();
    same(await page.getByText(UNCONFIRMED).count(), 0, 'the message');
  });

  console.log('-- log out');
  const gameCode = [releaseA, releaseB].flatMap((release) =>
    readdirSync(join(release, 'assets')).map((f) => `/assets/${f}`),
  );
  // Release A's script: no longer on the server, and not on the new worker's list.
  const oldBundle = `/assets/${readdirSync(join(releaseA, 'assets')).find((f) => f.endsWith('.js'))}`;
  await page.goto('/');
  await home();
  await check('before log out the old bundle is in the HTTP cache, so the checks below mean something', async () => {
    await context.setOffline(true);
    const served = await page.evaluate(async (path) => {
      try {
        return (await fetch(path, { cache: 'force-cache' })).ok;
      } catch {
        return false;
      }
    }, oldBundle);
    await context.setOffline(false);
    yes(served, `${oldBundle} is not in the HTTP cache`);
  });
  await check('log out goes to /login with every cache gone and the worker unregistered', async () => {
    await button(page, 'Log out').click();
    await page.waitForURL('**/login');
    same(await cacheNames(), [], 'caches');
    same(await workers(), 0, 'workers');
  });
  const tryAll = () =>
    page.evaluate(async (paths) => {
      const served = [];
      for (const path of paths) {
        try {
          const r = await fetch(path, { cache: 'force-cache' });
          if (r.ok && !r.redirected) served.push(path);
        } catch {
          /* not served */
        }
      }
      return served;
    }, gameCode);
  await check('logged out and online: no game code, even from the HTTP cache', async () => {
    same(await tryAll(), [], 'served');
    await page.goto('/');
    same(new URL(page.url()).pathname, '/login', 'path');
    same(await cacheNames(), [], 'caches after the visit');
    same(await workers(), 0, 'workers after the visit');
  });
  await goOffline();
  await check('logged out and offline: no game code, even from the HTTP cache', async () => {
    same(await tryAll(), [], 'served');
  });
  await check('logged out and offline: the app does not open', async () => {
    const failed = await page.goto('/').then(
      () => false,
      () => true,
    );
    yes(failed, 'a page opened');
    same(await page.getByRole('heading', { name: 'isoca play' }).count(), 0, 'the app is here');
  });
  await check('no Content Security Policy violation in the whole run', () => same(violations, [], 'violations'));
} catch (error) {
  failures += 1;
  console.log(`FAIL  the run stopped early\n      ${error.stack ?? error}`);
} finally {
  clearTimeout(watchdog);
  await browser?.close().catch(() => {});
  await stopServer().catch(() => {});
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

const passed = results.filter((r) => r.startsWith('PASS')).length;
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
