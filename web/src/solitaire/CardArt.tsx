// The approved card art (ivory face, moon-and-stars back), ported pixel for pixel as data.
// Drawn as SVG rects in the manner of the mahjong tiles. All the art is original.
import { memo } from 'react';
import { Pixels, runs, type Paint } from '../mahjong/TileArt';
import { rankOf, suitOf } from './rules';
import { SPRITE } from './layout';

export const RANK: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  10: ['.#..##.', '##.#..#', '.#.#..#', '.#.#..#', '.#.#..#', '.#.#..#', '###.##.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
};
export const SMALL: Record<string, string[]> = {
  heart: ['##.##', '#####', '#####', '.###.', '..#..'],
  diamond: ['..#..', '.###.', '#####', '.###.', '..#..'],
  spade: ['..#..', '.###.', '#####', '#####', '#.#.#', '..#..'],
  club: ['.###.', '.###.', '#####', '#####', '#.#.#', '..#..'],
};
export const BIG: Record<string, string[]> = {
  heart: ['.###...###.', '#++##.#####', '#+#########', '###########', '###########', '.#########.', '..#######..', '...#####...', '....###....', '.....#.....'],
  diamond: ['....#....', '...+##...', '..++###..', '.++#####.', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  spade: ['.....#.....', '....+##....', '...++###...', '..++#####..', '.#########.', '###########', '###########', '.##..#..##.', '....###....', '...#####...'],
  club: ['...#####...', '...++###...', '...+####...', '.##.###.##.', '#+#########', '###########', '.##..#..##.', '.....#.....', '....###....', '...#####...'],
};
export const COURT: Record<string, string[]> = {
  K: ['...y..yy..y...', '...yyyyyyyy...', '.k.yyyyyyyy.k.', 'kokkkkkkkkkkok', 'kooooooooooook', 'kookkooookkook', 'kookkooookkook', 'kosookookoosok', 'koooookkoooook', '.kooooooooook.', '..kkkkkkkkkk..', '..............'],
  Q: ['..kkk....kkk..', '.kwPk.yy.kPwk.', '.kwPk.yy.kPwk.', '.kwPkyyyykPwk.', '.kwwkkkkkkwwk.', 'kwwwwwwwwwwwwk', 'kwwkwwwwwwkwwk', 'kwwkwwwwwwkwwk', 'kPwwwkwwkwwwPk', 'kwwwwwkkwwwwwk', '.kwwwwwwwwwwk.', '..kkkkkkkkkk..'],
  J: ['......rr......', '.....rrrr.....', '.kkk.rrrr.kkk.', 'kwwwkkkkkkwwwk', 'kwkwkggggkwkwk', 'kwwwkggggkwwwk', '.kkkggggggkkk.', 'kggggggggggggk', 'kgsggggggggsgk', 'kggkggggggkggk', 'kgggkkkkkkgggk', '.kkkkkkkkkkkk.'],
};
const MOON = ['..###.', '.###..', '###...', '###...', '###...', '.###..', '..###.'];
const TWINKLE = ['..#..', '..#..', '#####', '..#..', '..#..'];

const COURT_COLOURS: Record<string, string> = {
  k: '#1b1026', w: '#ffffff', y: '#f5b700', o: '#ff9f5a', s: '#ffa69e', P: '#ff86b8', g: '#7fd14f', r: '#aa4465',
};
// The ivory face. Suits go by suitOf: 0 heart, 1 diamond, 2 club, 3 spade.
const IVORY = { outline: '#1b1026', fill: '#f6ecd6', edge: '#aa4465' };
const INK = ['#d93a4e', '#d93a4e', '#2a1838', '#2a1838'];
const SHINE = ['#ff9aa8', '#ff9aa8', '#6d5484', '#6d5484'];
const SUIT_KEYS = ['heart', 'diamond', 'club', 'spade'];
const SUIT_WORDS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANK_KEYS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_WORDS = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];
const DIM = '#4b3a5c';

const W = SPRITE.width;
const H = SPRITE.height;

function rect(x: number, y: number, width: number, height: number, fill: string): Paint {
  return { x, y, width, height, fill };
}

function painted(rows: string[], left: number, top: number, colourOf: (ch: string) => string | null): Paint[] {
  return runs(rows, left, top, (ch) => colourOf(ch) ?? '').filter((p) => p.fill !== '');
}

// Outline with cut corners, the face, then the bottom edge row.
function body(outline: string, fill: string, edge: string): Paint[] {
  return [
    rect(1, 0, W - 2, H, outline),
    rect(0, 1, W, H - 2, outline),
    rect(1, 1, W - 2, H - 2, fill),
    rect(1, H - 2, W - 2, 1, edge),
  ];
}

function frontPaint(card: number): Paint[] {
  const suit = suitOf(card);
  const rank = RANK_KEYS[rankOf(card) - 1];
  const suitKey = SUIT_KEYS[suit];
  const ink = INK[suit];
  const shine = SHINE[suit];
  const solid = (ch: string) => (ch === '#' ? ink : null);
  const paint = [
    ...body(IVORY.outline, IVORY.fill, IVORY.edge),
    ...painted(RANK[rank], rank === '10' ? 1 : 2, 2, solid),
    ...painted(SMALL[suitKey], 9, SMALL[suitKey].length === 5 ? 3 : 2, solid),
  ];
  if (COURT[rank]) return [...paint, ...painted(COURT[rank], 1, 10, (ch) => COURT_COLOURS[ch] ?? null)];
  const art = BIG[suitKey];
  const left = Math.floor((W - art[0].length) / 2);
  const top = 10 + Math.floor((12 - art.length) / 2);
  paint.push(...painted(art, left, top, (ch) => (ch === '#' ? ink : ch === '+' ? shine : null)));
  if (rank === 'A') {
    const mid = Math.floor(W / 2);
    const y = top + 3;
    const eye = IVORY.fill;
    paint.push(
      rect(mid - 3, y, 1, 2, eye),
      rect(mid + 2, y, 1, 2, eye),
      rect(mid - 2, y + 3, 1, 1, eye),
      rect(mid + 1, y + 3, 1, 1, eye),
      rect(mid - 1, y + 4, 2, 1, eye),
    );
  }
  return paint;
}

function backPaint(): Paint[] {
  const stars: [number, number][] = [[3, 3], [13, 12], [3, 16], [6, 20], [12, 21], [6, 12]];
  return [
    ...body('#1b1026', '#2f2259', '#5f3fb5'),
    ...painted(MOON, 8, 3, (ch) => (ch === '#' ? '#ffe27a' : null)),
    ...painted(TWINKLE, 2, 7, (ch) => (ch === '#' ? '#d5c6fb' : null)),
    ...painted(TWINKLE, 9, 15, (ch) => (ch === '#' ? '#a98bf0' : null)),
    ...stars.map(([x, y]) => rect(x, y, 1, 1, '#d5c6fb')),
  ];
}

function slotPaint(suit: number): Paint[] {
  const paint: Paint[] = [];
  for (let x = 1; x < W - 1; x += 2) paint.push(rect(x, 0, 1, 1, DIM), rect(x, H - 1, 1, 1, DIM));
  for (let y = 1; y < H - 1; y += 2) paint.push(rect(0, y, 1, 1, DIM), rect(W - 1, y, 1, 1, DIM));
  const art = BIG[SUIT_KEYS[suit]];
  paint.push(...painted(art, Math.floor((W - art[0].length) / 2), 7, () => DIM));
  return paint;
}

// The paint lists never change, so each is made once and shared by every card on the table.
const cache = new Map<string, Paint[]>();
function once(key: string, make: () => Paint[]): Paint[] {
  let paint = cache.get(key);
  if (!paint) {
    paint = make();
    cache.set(key, paint);
  }
  return paint;
}

export const cardName = (card: number): string => `${RANK_WORDS[rankOf(card) - 1]} of ${SUIT_WORDS[suitOf(card)]}`;

export const CardFace = memo(function CardFace({ card }: { card: number }) {
  return <Pixels paint={once(`f${card}`, () => frontPaint(card))} width={W} height={H} label={cardName(card)} />;
});

export const CardBack = memo(function CardBack() {
  return <Pixels paint={once('back', backPaint)} width={W} height={H} label="face-down card" />;
});

export const EmptyAnswerPile = memo(function EmptyAnswerPile({ suit }: { suit: number }) {
  return <Pixels paint={once(`s${suit}`, () => slotPaint(suit))} width={W} height={H} label={`empty ${SUIT_WORDS[suit]} pile`} />;
});
