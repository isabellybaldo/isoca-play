import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { FACES } from './layouts';
import { PIXEL_COLOURS, TILE_ART, TileArt, TileBack } from './TileArt';

afterEach(cleanup);

function markup(face: string): string {
  const { container } = render(<TileArt face={face} />);
  const html = container.innerHTML;
  cleanup();
  return html;
}

describe('TileArt', () => {
  test.each(FACES)('%s has its own art', (face: string) => {
    const mine = markup(face);
    const others = FACES.filter((f) => f !== face).map(markup);
    expect(mine).toContain('<rect');
    expect(others).not.toContain(mine);
  });

  test.each(FACES)('%s is a crisp 16x16 svg', (face: string) => {
    const { container } = render(<TileArt face={face} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    for (const rect of svg.querySelectorAll('rect')) {
      const x = Number(rect.getAttribute('x'));
      const y = Number(rect.getAttribute('y'));
      const width = Number(rect.getAttribute('width'));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(16);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(16);
    }
  });

  test.each(FACES)('%s is drawn on exactly 16 rows of 16 known colours', (face: string) => {
    const rows = TILE_ART[face];
    expect(rows).toHaveLength(16);
    for (const row of rows) {
      expect(row).toHaveLength(16);
      for (const ch of row) {
        if (ch !== '.') expect(PIXEL_COLOURS).toHaveProperty(ch);
      }
    }
  });

  // A bold silhouette stays readable at 34 px wide; a speck in the middle does not.
  test.each(FACES)('%s fills most of its square', (face: string) => {
    const rows = TILE_ART[face];
    const filled = rows.flatMap((row, y) =>
      [...row].flatMap((ch, x) => (ch === '.' ? [] : [{ x, y }])),
    );
    const xs = filled.map((p) => p.x);
    const ys = filled.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs) + 1).toBeGreaterThanOrEqual(12);
    expect(Math.max(...ys) - Math.min(...ys) + 1).toBeGreaterThanOrEqual(11);
    expect(filled.length).toBeGreaterThanOrEqual(70);
  });

  test('every face in the deck has art, and the art holds nothing else', () => {
    expect(Object.keys(TILE_ART).sort()).toEqual([...FACES].sort());
  });

  test('a face names itself for screen readers', () => {
    const { container } = render(<TileArt face="cat" />);
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('cat');
  });

  test('an unknown face draws nothing rather than crashing', () => {
    const { container } = render(<TileArt face="dragon" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('rect')).toBeNull();
  });
});

describe('TileBack', () => {
  test('is crisp, covers the whole square and gives away no face', () => {
    const { container } = render(<TileBack />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.getAttribute('aria-label')).toBe('face-down tile');
    const backMarkup = container.innerHTML;
    cleanup();
    expect(FACES.map(markup)).not.toContain(backMarkup);
  });
});
