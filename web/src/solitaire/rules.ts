// A card is 0-51: suit * 13 + rank - 1. Suits: 0 heart, 1 diamond, 2 club, 3 spade. Rank 1 is the ace.
// A deal is 52 cards: the first 28 fill columns 0 to 6 in turn, each column's last card on top;
// the last 24 are the pile, deal[28] turned first.
export type Pile = 'w' | `f${0 | 1 | 2 | 3}` | `c${0 | 1 | 2 | 3 | 4 | 5 | 6}`;

// 'd' turns a card, 'r' turns the pile back over, 'c3>c5:2' moves 2 cards. A history entry
// adds '!' when the move turned a face-down card over.
export type Move = string;

export type Column = { down: number[]; up: number[] }; // last of each is nearest the top

export type SolitaireState = {
  deal: number[];
  stock: number[]; // stock[0] turns next
  waste: number[]; // last is on top
  columns: Column[]; // 7
  foundations: number[]; // 4 counts, by suit
  history: Move[];
  status: 'playing' | 'won';
};

export const suitOf = (card: number): number => Math.floor(card / 13);
export const rankOf = (card: number): number => (card % 13) + 1;
export const isRed = (card: number): boolean => suitOf(card) < 2;

export function newSolitaire(deal: number[]): SolitaireState {
  const columns: Column[] = [];
  let at = 0;
  for (let i = 0; i < 7; i++) {
    const cards = deal.slice(at, at + i + 1);
    at += i + 1;
    columns.push({ down: cards.slice(0, -1), up: cards.slice(-1) });
  }
  return {
    deal,
    stock: deal.slice(28),
    waste: [],
    columns,
    foundations: [0, 0, 0, 0],
    history: [],
    status: 'playing',
  };
}

const PILE = /^(?:w|f[0-3]|c[0-6])$/;
const MOVE = /^([wfc][0-6]?)>([fc][0-6]):([1-9]\d*)$/;

const isPile = (text: string): text is Pile => PILE.test(text);

// A copy to change; the state it came from is never touched.
function copy(s: SolitaireState): SolitaireState {
  return {
    ...s,
    stock: [...s.stock],
    waste: [...s.waste],
    columns: s.columns.map((c) => ({ down: [...c.down], up: [...c.up] })),
    foundations: [...s.foundations],
  };
}

// The cards that would leave `from`, bottom first, or null if it cannot give n.
function lifted(s: SolitaireState, from: Pile, n: number): number[] | null {
  if (from === 'w') return n === 1 && s.waste.length > 0 ? [s.waste[s.waste.length - 1]] : null;
  const index = Number(from[1]);
  if (from[0] === 'f') {
    return n === 1 && s.foundations[index] > 0 ? [index * 13 + s.foundations[index] - 1] : null;
  }
  const up = s.columns[index].up;
  return n >= 1 && n <= up.length ? up.slice(up.length - n) : null;
}

export function canMove(s: SolitaireState, from: Pile, to: Pile, n: number): boolean {
  if (s.status !== 'playing' || from === to || to === 'w' || !Number.isInteger(n)) return false;
  const cards = lifted(s, from, n);
  if (!cards) return false;
  const lead = cards[0];
  const index = Number(to[1]);
  if (to[0] === 'f') {
    return n === 1 && from[0] !== 'f' && suitOf(lead) === index && rankOf(lead) === s.foundations[index] + 1;
  }
  const column = s.columns[index];
  if (column.up.length === 0) return column.down.length === 0 && rankOf(lead) === 13;
  const top = column.up[column.up.length - 1];
  return rankOf(top) === rankOf(lead) + 1 && isRed(top) !== isRed(lead);
}

function won(foundations: number[]): boolean {
  return foundations.every((count) => count === 13);
}

export function move(s: SolitaireState, from: Pile, to: Pile, n: number): SolitaireState {
  if (!canMove(s, from, to, n)) return s;
  const next = copy(s);
  const cards = lifted(s, from, n)!;
  let turned = false;
  if (from === 'w') {
    next.waste.pop();
  } else if (from[0] === 'f') {
    next.foundations[Number(from[1])]--;
  } else {
    const column = next.columns[Number(from[1])];
    column.up.length -= n;
    if (column.up.length === 0 && column.down.length > 0) {
      column.up.push(column.down.pop()!);
      turned = true;
    }
  }
  if (to[0] === 'f') next.foundations[Number(to[1])]++;
  else next.columns[Number(to[1])].up.push(...cards);
  next.history = [...s.history, `${from}>${to}:${n}${turned ? '!' : ''}`];
  next.status = won(next.foundations) ? 'won' : 'playing';
  return next;
}

export function tapPile(s: SolitaireState): SolitaireState {
  if (s.status !== 'playing') return s;
  if (s.stock.length > 0) {
    return { ...s, stock: s.stock.slice(1), waste: [...s.waste, s.stock[0]], history: [...s.history, 'd'] };
  }
  if (s.waste.length > 0) return { ...s, stock: [...s.waste], waste: [], history: [...s.history, 'r'] };
  return s;
}

export function sendUp(s: SolitaireState, from: Pile): SolitaireState {
  if (from[0] === 'f') return s;
  const cards = lifted(s, from, 1);
  return cards ? move(s, from, `f${suitOf(cards[0])}` as Pile, 1) : s;
}

export function applyMove(s: SolitaireState, m: Move): SolitaireState {
  if (m === 'd' || m === 'r') {
    // The wrong one of the two does nothing.
    if ((m === 'd') !== (s.stock.length > 0)) return s;
    return tapPile(s);
  }
  const parts = MOVE.exec(m);
  if (!parts || !isPile(parts[1]) || !isPile(parts[2])) return s;
  return move(s, parts[1], parts[2], Number(parts[3]));
}

// Takes back the last move, working from its text and its '!'.
export function undo(s: SolitaireState): SolitaireState {
  const last = s.history[s.history.length - 1];
  if (!last) return s;
  const history = s.history.slice(0, -1);
  if (last === 'd') {
    return { ...s, stock: [s.waste[s.waste.length - 1], ...s.stock], waste: s.waste.slice(0, -1), history, status: 'playing' };
  }
  if (last === 'r') return { ...s, stock: [], waste: [...s.stock], history, status: 'playing' };

  const parts = MOVE.exec(last.replace('!', ''))!;
  const from = parts[1];
  const to = parts[2];
  const n = Number(parts[3]);
  const next = copy(s);
  next.history = history;
  next.status = 'playing';

  // Take the cards back off where they landed.
  let cards: number[];
  if (to[0] === 'f') {
    const suit = Number(to[1]);
    next.foundations[suit]--;
    cards = [suit * 13 + next.foundations[suit]];
  } else {
    const up = next.columns[Number(to[1])].up;
    cards = up.splice(up.length - n, n);
  }

  // And put them where they came from, face down again first if the move turned a card.
  if (from === 'w') {
    next.waste.push(...cards);
  } else if (from[0] === 'f') {
    next.foundations[Number(from[1])]++;
  } else {
    const column = next.columns[Number(from[1])];
    if (last.endsWith('!')) column.down.push(column.up.pop()!);
    column.up.push(...cards);
  }
  return next;
}

// A new deal would throw away work: there are moves, and the game is not won.
export function hasMovesToLose(s: SolitaireState): boolean {
  return s.history.length > 0 && s.status !== 'won';
}
