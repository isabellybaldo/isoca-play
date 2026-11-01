// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { build } from 'vite';

// A real production build, because the page goes out as one file in a sandboxed
// frame: null origin, no CORS headers, nothing else to load.
describe('the built page', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'isoca-play-build-'));
  let files: string[] = [];
  let html = '';

  beforeAll(async () => {
    // Vitest runs in test mode; without this the build would carry dev React.
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    await build({ logLevel: 'silent', mode: 'production', build: { outDir, emptyOutDir: true } });
    process.env.NODE_ENV = env;
    files = readdirSync(outDir);
    html = readFileSync(join(outDir, 'index.html'), 'utf8');
  }, 120_000);

  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  test('is one file, with its script and styles inline', () => {
    expect(files).toEqual(['index.html']);
    // React's own code mentions these words, so look at the tags alone.
    const tags = html.replace(/(<(script|style)\b[^>]*>)[\s\S]*?<\/\2>/g, '$1');
    expect(tags).not.toMatch(/crossorigin/);
    // The one link is an empty icon, which stops the browser asking for /favicon.ico.
    expect(tags.match(/<link\b[^>]*>/g)).toEqual(['<link rel="icon" href="data:," />']);
    expect(tags).not.toMatch(/<script[^>]*\bsrc=/);
    expect(html).toMatch(/<style[\s>]/);
    expect(html).toMatch(/<script[^>]*>[\s\S]{1000}/);
  });

  test('carries the three latin woff2 fonts as data URIs and nothing else', () => {
    const faces = html.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    const families = faces.map((f) => /font-family:\s*['"]?([^'";]+)/.exec(f)![1]).sort();
    expect(families).toEqual(['IBM Plex Mono', 'Press Start 2P', 'VT323']);
    for (const face of faces) {
      const urls = face.match(/url\([^)]*\)/g) ?? [];
      expect(urls).toHaveLength(1);
      expect(urls[0]).toMatch(/^url\(["']?data:font\/woff2;base64,/);
    }
    expect(html).not.toMatch(/\.woff2?\b/);
  });

  test('stays small', () => {
    expect(html.length).toBeLessThan(400_000);
  });
});
