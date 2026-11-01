import { canMove, isRed, rankOf, type Pile, type SolitaireState } from './rules';

// A tip built from what the player can see: face-up cards, how many cards lie face down, and
// how many are in the pile. The order and contents of `stock` are never read.
export type Tip =
  | { kind: 'move'; from: Pile; to: Pile; n: number; line: string }
  | { kind: 'turn'; line: string }
  | { kind: 'none'; line: string };

const COLUMNS = [0, 1, 2, 3, 4, 5, 6] as const;
const columnPile = (i: number) => `c${i}` as Pile;
const answerPile = (suit: number) => `f${suit}` as Pile;

const topOf = (s: SolitaireState, from: Pile): number | undefined => {
  if (from === 'w') return s.waste[s.waste.length - 1];
  const up = s.columns[Number(from[1])].up;
  return up[up.length - 1];
};

const move = (from: Pile, to: Pile, n: number, line: string): Tip => ({ kind: 'move', from, to, n, line });

// An answer pile takes the card without hurting: an ace or two, or no more than one above
// the lower of the two answer piles of the other colour.
function safe(s: SolitaireState, card: number): boolean {
  const rank = rankOf(card);
  if (rank <= 2) return true;
  const others = isRed(card) ? [2, 3] : [0, 1];
  return rank <= 1 + Math.min(s.foundations[others[0]], s.foundations[others[1]]);
}

// How many pile cards were turned since the last move that was not a turn.
function turnedSinceMove(s: SolitaireState): number {
  let n = 0;
  for (let i = s.history.length - 1; i >= 0; i--) {
    const entry = s.history[i];
    if (entry === 'd') n++;
    else if (entry !== 'r') break;
  }
  return n;
}

export function tipFor(s: SolitaireState): Tip {
  const onAnswer = (from: Pile, card: number): Pile | undefined => {
    const to = answerPile(Math.floor(card / 13));
    return canMove(s, from, to, 1) ? to : undefined;
  };

  // 1. A move that turns over a face-down card.
  for (const i of COLUMNS) {
    const column = s.columns[i];
    if (column.down.length === 0 || column.up.length === 0) continue;
    const from = columnPile(i);
    const n = column.up.length;
    for (const j of COLUMNS) {
      if (j !== i && canMove(s, from, columnPile(j), n)) {
        return move(from, columnPile(j), n, 'Moving this turns over a face-down card.');
      }
    }
    if (n === 1) {
      const to = onAnswer(from, column.up[0]);
      if (to) return move(from, to, 1, 'Sending this up turns over a face-down card.');
    }
  }

  // 2. A move to an answer pile that cannot hurt.
  for (const from of ['w', ...COLUMNS.map(columnPile)] as Pile[]) {
    const card = topOf(s, from);
    if (card === undefined || !safe(s, card)) continue;
    const to = onAnswer(from, card);
    if (to) return move(from, to, 1, 'This can go up and cannot get in the way of anything.');
  }

  // 3. A king from the pile into an empty column, when it uncovers a pile card.
  // (A king with face-down cards under it was found by rule 1; one without is not moved.)
  const king = topOf(s, 'w');
  if (king !== undefined && rankOf(king) === 13 && s.waste.length > 1) {
    for (const j of COLUMNS) {
      if (canMove(s, 'w', columnPile(j), 1)) {
        return move('w', columnPile(j), 1, 'The king fits the empty column, and the pile card under it is open again.');
      }
    }
  }

  // 4. Any other move from the face-up pile.
  if (king !== undefined && rankOf(king) !== 13) {
    for (const j of COLUMNS) {
      if (canMove(s, 'w', columnPile(j), 1)) {
        return move('w', columnPile(j), 1, 'The card showing from the pile fits here.');
      }
    }
    const to = onAnswer('w', king);
    if (to) return move('w', to, 1, 'The card showing from the pile can go up.');
  }

  // 6. A whole pass through the pile with nothing else played.
  if (turnedSinceMove(s) >= s.stock.length + s.waste.length) {
    return { kind: 'none', line: 'No move stands out. Use Return to back up.' };
  }

  // 5. Turn the next pile card.
  return { kind: 'turn', line: 'Nothing else to play. Turn the next card from the pile.' };
}
