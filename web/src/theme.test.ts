import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const css = readFileSync('src/theme.css', 'utf8');

test('the theme stops double-tap zoom and sets the palette', () => {
  expect(css).toMatch(/touch-action:\s*manipulation/);
  expect(css).toContain('#93e1d8');
  expect(css).not.toMatch(/https?:\/\//); // nothing from third parties
});

test.each([
  ['page', '#120a1a'],
  ['bg', '#1b1026'],
  ['card', '#241532'],
  ['bar', '#2a1838'],
  ['line', '#93e1d8'],
  ['line2', '#4b3a5c'],
  ['fg', '#ddfff7'],
  ['accent', '#ffa69e'],
  ['rose', '#aa4465'],
  ['dim', '#b9a6c9'],
])('the theme defines --%s as %s', (name, value) => {
  expect(css).toMatch(new RegExp(`--${name}:[ ]*${value};`));
});

test('double-tap protection reaches every element, not just the page', () => {
  expect(css).toMatch(/(^|\n)\*[^{]*\{[^}]*touch-action:\s*manipulation/);
});

test('buttons meet the tap target by default', () => {
  expect(css).toMatch(/(^|\n)button\s*\{[^}]*min-height:\s*var\(--tap\)/);
  expect(css).toMatch(/--tap:\s*44px/);
});

test('the three fonts are self-hosted and named in the theme', () => {
  const fonts = readFileSync('src/fonts.css', 'utf8');
  for (const pkg of ['press-start-2p', 'vt323', 'ibm-plex-mono']) {
    expect(fonts).toContain(`@fontsource/${pkg}`);
  }
  for (const family of ['Press Start 2P', 'VT323', 'IBM Plex Mono']) {
    expect(css).toContain(`'${family}'`);
  }
});
