import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { FACES } from './layouts';
import { FaceArt, PIXEL_COLOURS, TILE_ART, TileArt, TileBack } from './TileArt';

afterEach(cleanup);

function markup(face: string): string {
  const { container } = render(<TileArt face={face} />);
  const html = container.innerHTML;
  cleanup();
  return html;
}

type Pixel = { x: number; y: number; width: number; height: number; fill: string };

function pixels(svg: Element): Pixel[] {
  return [...svg.querySelectorAll('rect')].map((r) => ({
    x: Number(r.getAttribute('x')),
    y: Number(r.getAttribute('y')),
    width: Number(r.getAttribute('width')),
    height: Number(r.getAttribute('height')),
    fill: r.getAttribute('fill')!,
  }));
}

// The colour a spot ends up, painting the rects in order.
function colourAt(svg: Element, x: number, y: number): string | undefined {
  let at: string | undefined;
  for (const p of pixels(svg)) {
    if (x >= p.x && x < p.x + p.width && y >= p.y && y < p.y + p.height) at = p.fill;
  }
  return at;
}

const inks = (rows: string[]) => new Set(rows.join('').replaceAll('.', ''));

const OUTLINE = '#1b1026';
const IVORY = '#f6ecd6';
const ROSE = '#aa4465';
const DEEP_ROSE = '#7a3049';

describe('TileArt', () => {
  test.each(FACES)('%s has its own art', (face: string) => {
    const mine = markup(face);
    const others = FACES.filter((f) => f !== face).map(markup);
    expect(others).not.toContain(mine);
  });

  test.each(FACES)('%s is a crisp 18 x 23 sprite', (face: string) => {
    const { container } = render(<TileArt face={face} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 18 23');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    for (const p of pixels(svg)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(18);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height).toBeLessThanOrEqual(23);
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

  test.each(FACES)('%s draws each pixel at x+1, y+2', (face: string) => {
    const { container } = render(<TileArt face={face} />);
    const svg = container.querySelector('svg')!;
    TILE_ART[face].forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch !== '.') expect(colourAt(svg, x + 1, y + 2)).toBe(PIXEL_COLOURS[ch]);
      });
    });
  });

  test('the sprite has the cut corners, ivory face and rose edge', () => {
    const { container } = render(<TileArt face="circle1" />);
    const svg = container.querySelector('svg')!;
    for (const [x, y] of [[0, 0], [17, 0], [0, 22], [17, 22]]) expect(colourAt(svg, x, y)).toBeUndefined();
    expect(colourAt(svg, 1, 0)).toBe(OUTLINE);
    expect(colourAt(svg, 0, 1)).toBe(OUTLINE);
    expect(colourAt(svg, 1, 1)).toBe('#f9f3e4'); // the lighter top row
    expect(colourAt(svg, 1, 2)).toBe(IVORY);
    expect(colourAt(svg, 1, 18)).toBe(IVORY);
    expect(colourAt(svg, 1, 19)).toBe(OUTLINE);
    expect(colourAt(svg, 1, 20)).toBe(ROSE);
    expect(colourAt(svg, 1, 21)).toBe(DEEP_ROSE);
    expect(colourAt(svg, 1, 22)).toBe(OUTLINE);
  });

  test('every face in the deck has art, and the art holds nothing else', () => {
    expect(Object.keys(TILE_ART).sort()).toEqual([...FACES].sort());
  });

  test('the colours are the approved ones, and none goes unused', () => {
    const used = inks(Object.values(TILE_ART).flat());
    expect(Object.keys(PIXEL_COLOURS).sort()).toEqual([...used].sort());
    expect(PIXEL_COLOURS.R).toBe('#d93a4e');
    expect(PIXEL_COLOURS.y).toBe('#f5b700');
    expect(PIXEL_COLOURS.b).toBe('#2f7fd6');
    expect(PIXEL_COLOURS.e).toBe('#2f9e5f');
    expect(PIXEL_COLOURS.V).toBe('#5f3fb5');
  });

  test('the suits are what the owner picked', () => {
    // The 1 of circles is one plain red disc; the rest are solid pips, in three inks.
    expect(inks(TILE_ART.circle1)).toEqual(new Set(['R']));
    expect(inks(TILE_ART.circle9)).toEqual(new Set(['R', 'b', 'e']));
    // The 1 of bamboo is the panda, the 1 of stars the moon, and the stars twinkle in violet.
    expect(TILE_ART.bamboo1[6]).toBe('.kwkkkwwwwkkkwk.');
    expect(TILE_ART.star1[9]).toBe('kpspppppkkkkkkpk');
    expect(inks(TILE_ART.star5)).toEqual(new Set(['V', 'p']));
    // Winter is the snowy tree, not the snowflake also defined in the preview.
    expect(TILE_ART.winter[12]).toBe('.GGGGGGGGGGGGGG.');
  });

  test('a face names itself for screen readers', () => {
    const { container } = render(<TileArt face="cat" />);
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('cat');
  });

  test('an unknown face draws a blank tile rather than crashing', () => {
    const { container } = render(<TileArt face="dragon" />);
    expect(colourAt(container.querySelector('svg')!, 8, 10)).toBe(IVORY);
  });
});

describe('FaceArt', () => {
  test('is the bare 16 x 16 drawing, with no tile around it', () => {
    const { container } = render(<FaceArt face="heart" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(colourAt(svg, 0, 0)).toBeUndefined();
    expect(colourAt(svg, 8, 8)).toBe(PIXEL_COLOURS[TILE_ART.heart[8][8]]);
  });
});

describe('TileBack', () => {
  test('is the rose sprite with the salmon heart at y+3, and gives away no face', () => {
    const { container } = render(<TileBack />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 18 23');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.getAttribute('aria-label')).toBe('face-down tile');
    expect(colourAt(svg, 0, 0)).toBeUndefined();
    expect(colourAt(svg, 1, 1)).toBe('#c8859b'); // the lighter top row
    expect(colourAt(svg, 1, 2)).toBe(ROSE);
    expect(colourAt(svg, 5, 6)).toBe('#ffa69e'); // the heart's first row: mark x 4, y 3
    expect(colourAt(svg, 8, 13)).toBe('#ffa69e'); // its tip: mark x 7, y 10
    expect(colourAt(svg, 8, 14)).toBe(ROSE);
    expect(colourAt(svg, 1, 20)).toBe(ROSE);
    expect(colourAt(svg, 1, 21)).toBe(DEEP_ROSE);
    const backMarkup = container.innerHTML;
    cleanup();
    expect(FACES.map(markup)).not.toContain(backMarkup);
  });
});
