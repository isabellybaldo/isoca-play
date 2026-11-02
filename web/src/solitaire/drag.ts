import type { Pile } from './rules';

// A place a run can land, in the same coordinates as the point given to dropPile.
export type PileBox = { pile: Pile; left: number; right: number; top: number; bottom: number };

// The pile under the point, or null in a gap. Right and bottom edges belong to the next box.
export function dropPile(boxes: PileBox[], x: number, y: number): Pile | null {
  const hit = boxes.find((box) => x >= box.left && x < box.right && y >= box.top && y < box.bottom);
  return hit ? hit.pile : null;
}
