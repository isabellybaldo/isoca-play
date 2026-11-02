// Sizes for the table. Cards are 16 x 24 sprites shown at whole-number scales only.
export const SPRITE = { width: 16, height: 24 };

// 8 + 44 bar + 6 + 44 tip line + 6 + 8. The top row and its 6 px gap are extra.
export const TABLE_CHROME = 116;

// Rows of the sprite a card shows when it is covered by the next one.
const DOWN_ROWS = 4;
const UP_ROWS = 10;
const MIN_DOWN_ROWS = 1;
const MIN_UP_ROWS = 9; // the rank ends at sprite row 8

// The worst column: 6 face-down and 13 face-up cards.
const WORST = { down: 6, up: 13 };

function columnHeight(column: { down: number; up: number }, scale: number, pitch: { down: number; up: number }): number {
  const { down, up } = column;
  if (down + up === 0) return 0;
  const covered = up > 0 ? down * pitch.down + (up - 1) * pitch.up : (down - 1) * pitch.down;
  return covered + SPRITE.height * scale;
}

export function cardScale(vw: number, vh: number): 2 | 3 | 4 {
  for (const s of [4, 3, 2] as const) {
    const acrossFits = 7 * SPRITE.width * s + 12 + 8 <= vw;
    const room = vh - TABLE_CHROME - (SPRITE.height * s + 6);
    const tightest = { down: MIN_DOWN_ROWS * s, up: MIN_UP_ROWS * s };
    if (acrossFits && columnHeight(WORST, s, tightest) <= room) return s;
  }
  return 2;
}

// Sideways, with the worst column longer than even 2x can fit. The page doesn't scroll, so the
// end of such a column can't be reached this way up.
export function tooShortSideways(vw: number, vh: number): boolean {
  const room = vh - TABLE_CHROME - (SPRITE.height * 2 + 6);
  return vw > vh && columnHeight(WORST, 2, { down: MIN_DOWN_ROWS * 2, up: MIN_UP_ROWS * 2 }) > room;
}

// A column's width, which is also its tap area. The brief's min(card + 8, ...) would give a 2x
// card only 40 px, so the cap is raised to 44 px, the least a finger needs.
const MIN_TAP = 44;

export function cellWidth(vw: number, scale: number): number {
  const card = SPRITE.width * scale;
  return Math.min(Math.max(card + 8, MIN_TAP), Math.max(card + 2, Math.floor((vw - 8) / 7)));
}

// Whole sprite rows only, in px. Face-down cards tighten first, then face-up ones.
export function columnPitches(
  column: { down: number; up: number },
  scale: number,
  available: number,
): { down: number; up: number } {
  const pitch = { down: DOWN_ROWS * scale, up: UP_ROWS * scale };
  while (columnHeight(column, scale, pitch) > available && pitch.down > MIN_DOWN_ROWS * scale) pitch.down -= scale;
  while (columnHeight(column, scale, pitch) > available && pitch.up > MIN_UP_ROWS * scale) pitch.up -= scale;
  return pitch;
}
