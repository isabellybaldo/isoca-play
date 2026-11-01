import { describe, expect, it } from 'vitest';
import { TABLE_CHROME, cardScale, cellWidth, columnPitches } from './layout';

describe('card sizes', () => {
  it('picks the scale from the screen', () => {
    expect(cardScale(320, 568)).toBe(2);
    expect(cardScale(355, 800)).toBe(2);
    expect(cardScale(360, 640)).toBe(3);
    expect(cardScale(360, 560)).toBe(2);
    expect(cardScale(915, 412)).toBe(2);
  });

  it('always fits the worst column', () => {
    for (const [vw, vh] of [[320, 568], [360, 640], [412, 915]]) {
      const s = cardScale(vw, vh);
      const top = 24 * s + 6;
      const room = vh - TABLE_CHROME - top;
      const p = columnPitches({ down: 6, up: 13 }, s, room);
      expect(6 * p.down + 12 * p.up + 24 * s).toBeLessThanOrEqual(room);
      expect(p.up).toBeGreaterThanOrEqual(9 * s);
    }
  });

  it('keeps full pitches when there is room', () => {
    expect(columnPitches({ down: 2, up: 2 }, 3, 500)).toEqual({ down: 12, up: 30 });
  });

  it('keeps the tap area wide', () => {
    expect(cellWidth(320, 2)).toBeGreaterThanOrEqual(44);
  });
});
