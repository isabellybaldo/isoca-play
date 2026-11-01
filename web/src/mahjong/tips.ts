import { faceName } from './TileArt';
import { freePairs, isCovered, isFree, matchKey, type MahjongState } from './rules';

// A tip built from what the player can see. A covered tile's face is never read: rules 1 to 3
// look only at free tiles and slots, and rule 4 counts positions alone.
export type MahjongTip = { tiles: number[]; line: string };

const faceOf = (s: MahjongState, id: number) => s.tiles.find((t) => t.id === id)!.face;
const plural = (n: number) => `${n} ${n === 1 ? 'tile' : 'tiles'}`;

// How many other tiles become free or uncovered when this one is gone.
function gain(s: MahjongState, id: number): number {
  const after: MahjongState = { ...s, onBoard: s.onBoard.filter((b) => b !== id) };
  let n = 0;
  for (const other of after.onBoard) {
    const newlyFree = !isFree(s, other) && isFree(after, other);
    const newlyUncovered = isCovered(s, other) && !isCovered(after, other);
    if (newlyFree || newlyUncovered) n++;
  }
  return n;
}

export function mahjongTip(s: MahjongState): MahjongTip {
  const free = s.onBoard.filter((id) => isFree(s, id));

  if (!s.noSlots) {
    // 1. A free tile pairs with one already in a slot.
    for (const held of s.slots) {
      const match = free.find((id) => matchKey(faceOf(s, id)) === matchKey(faceOf(s, held)));
      if (match !== undefined) {
        return {
          tiles: [match],
          line: `This pairs with the ${faceName(faceOf(s, held)).toLowerCase()} in your slots.`,
        };
      }
    }
    // 2. Any tile sent now would be a fourth with no pair.
    if (s.slots.length >= 3) {
      return {
        tiles: [],
        line: 'Three slots are full and nothing open pairs with them. Any tile you send now loses; use Return.',
      };
    }
  }

  // 3. Two open tiles match.
  const pair = freePairs(s)[0];
  if (pair) {
    return {
      tiles: [...pair],
      line: s.noSlots
        ? 'Both are open and they match. Tap one, then the other.'
        : 'Both are open and they match. Send them one after the other; the second pairs at once.',
    };
  }

  // 4. No pair is open: take the open tile that frees the most.
  let best: number | undefined;
  let bestGain = -1;
  for (const id of free) {
    const g = gain(s, id);
    if (g > bestGain) {
      best = id;
      bestGain = g;
    }
  }
  if (best === undefined) return { tiles: [], line: 'No open tile is left to play. Use Return.' };
  return {
    tiles: [best],
    line:
      bestGain > 0
        ? `No open pair. Taking this one away frees or uncovers ${plural(bestGain)}.`
        : 'No open pair, and no tile frees another. This one is as good as any.',
  };
}
