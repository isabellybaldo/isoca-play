// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { build } from 'vite';

// A real production build. The strict CSP allows only files of our own, so nothing is
// inline, and no request may go to a third party.
describe('the built site', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'isoca-play-build-'));
  let assets: string[] = [];
  let html = '';
  const assetText = (ext: string) =>
    assets.filter((f) => f.endsWith(ext)).map((f) => readFileSync(join(outDir, 'assets', f), 'utf8'));

  beforeAll(async () => {
    // Vitest runs in test mode; without this the build would carry dev React.
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    await build({ logLevel: 'silent', mode: 'production', build: { outDir, emptyOutDir: true } });
    process.env.NODE_ENV = env;
    assets = readdirSync(join(outDir, 'assets'));
    html = readFileSync(join(outDir, 'index.html'), 'utf8');
  }, 120_000);

  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  test('has hashed script and style files, and the page loads them from the root', () => {
    expect(assets.filter((f) => f.endsWith('.js')).length).toBeGreaterThan(0);
    expect(assets.filter((f) => f.endsWith('.css')).length).toBeGreaterThan(0);
    for (const file of assets) expect(file).toMatch(/-[\w-]{8}\.\w+$/);
    expect(html).toMatch(/<script[^>]*\bsrc="\/assets\/[^"]+\.js"/);
    expect(html).toMatch(/<link[^>]*\bhref="\/assets\/[^"]+\.css"/);
  });

  test('has no inline script, style or handler', () => {
    expect(html.match(/<script\b[^>]*>/g)!.every((tag) => /\bsrc=/.test(tag))).toBe(true);
    expect(html).not.toMatch(/<script\b[^>]*>[^<]+<\/script>/);
    expect(html).not.toMatch(/<style[\s>]/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son\w+=/);
  });

  test('asks no third party for anything', () => {
    expect(html).not.toMatch(/https?:\/\//);
    for (const css of assetText('.css')) expect(css).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
    // React's messages hold links, which are only text; nothing is fetched from a full URL.
    for (const js of assetText('.js')) expect(js).not.toMatch(/fetch\(\s*["'`]https?:/);
  });

  test('ships the three latin woff2 fonts and no other font, none of them inlined', () => {
    const fonts = assets.filter((f) => /\.(woff2?|ttf|otf|eot)$/.test(f));
    expect(fonts.map((f) => f.replace(/-[\w-]{8}\.woff2$/, '')).sort()).toEqual([
      'ibm-plex-mono-latin-400-normal',
      'press-start-2p-latin-400-normal',
      'vt323-latin-400-normal',
    ]);
    const css = assetText('.css').join('');
    expect(css).not.toMatch(/data:font/);
    expect(css.match(/@font-face/g)).toHaveLength(3);
  });

  test('writes the asset list and a version into the worker, and leaves no placeholder', () => {
    const worker = readFileSync(join(outDir, 'sw.js'), 'utf8');
    expect(worker).not.toContain('__SW_');
    expect(worker).toMatch(/const VERSION = '[0-9a-f]{16}';/);
    const listed = JSON.parse(/const ASSETS = (\[.*?\]);/.exec(worker)![1]) as string[];
    expect(listed).toEqual(assets.map((f) => `/assets/${f}`).sort());
  });

  test('carries no sudoku puzzle or local deal', () => {
    const js = assetText('.js').join('');
    // A solution from the old starter set, and the deal's seeded random number.
    expect(js).not.toContain('687251934254893167931467852793146528415328679862579341128735496349682715576914283');
    expect(js).not.toMatch(/1831565813|0x6d2b79f5/i);
  });
});
