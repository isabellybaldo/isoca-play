import { describe, expect, test } from 'vitest';
import {
  isCovered,
  freePairs,
  isFree,
  matchKey,
  newGame,
  tap,
  tapElsewhere,
  undo,
  type MahjongState,
  type Tile,
} from './rules';

const t = (id: number, x: number, y: number, z: number, face: string): Tile => ({ id, x, y, z, face });

// One tile per face, ids 0..n-1, spaced 4 apart on one row so that all are free.
const pairRow = (faces: string[]): Tile[] => faces.map((face, i) => t(i, i * 4, 0, 0, face));

// Two taps on the same tile: select, then send.
const send = (s: MahjongState, id: number): MahjongState => tap(tap(s, id), id);

describe('free and covered', () => {
  test('a covered tile is not free, and is freed when the top leaves', () => {
    const s = newGame([t(1, 0, 0, 0, 'a'), t(2, 0, 0, 1, 'b'), t(3, 4, 0, 0, 'a'), t(4, 8, 0, 0, 'b')]);
    expect(isCovered(s, 1)).toBe(true);
    expect(isFree(s, 1)).toBe(false);
    expect(isFree(s, 2)).toBe(true);

    const after = send(send(s, 4), 2); // b, b: a pair, the top tile leaves
    expect(after.onBoard).not.toContain(2);
    expect(isCovered(after, 1)).toBe(false);
    expect(isFree(after, 1)).toBe(true);
  });

  test('half-offset tiles still cover', () => {
    const s = newGame([t(1, 0, 0, 0, 'a'), t(2, 1, 1, 1, 'a')]);
    expect(isCovered(s, 1)).toBe(true);
  });

  test('a tile a full tile away does not cover', () => {
    const s = newGame([t(1, 0, 0, 0, 'a'), t(2, 2, 0, 1, 'a'), t(3, 0, 2, 1, 'a')]);
    expect(isCovered(s, 1)).toBe(false);
  });

  test('a tile blocked on both sides is not free, one open side is', () => {
    const s = newGame([t(1, 0, 0, 0, 'a'), t(2, 2, 0, 0, 'b'), t(3, 4, 0, 0, 'a'), t(4, 0, 8, 0, 'b')]);
    expect(isFree(s, 2)).toBe(false);
    expect(isCovered(s, 2)).toBe(false);
    expect(isFree(s, 1)).toBe(true);
    expect(isFree(s, 3)).toBe(true);
    expect(isFree(s, 4)).toBe(true);
  });

  test('a neighbour half a tile off in y still blocks the side', () => {
    const s = newGame([t(1, 0, 0, 0, 'a'), t(2, 2, 1, 0, 'b'), t(3, 4, 0, 0, 'a')]);
    expect(isFree(s, 2)).toBe(false);
  });
});

describe('taps', () => {
  test('first tap selects, second tap sends', () => {
    let s = newGame(pairRow(['a', 'b', 'a', 'b']));
    s = tap(s, 0);
    expect(s.selected).toBe(0);
    expect(s.slots).toEqual([]);
    s = tap(s, 0);
    expect(s.selected).toBe(null);
    expect(s.slots).toEqual([0]);
    expect(s.onBoard).not.toContain(0);
  });

  test('tapping another free tile moves the selection; a blocked tile does nothing', () => {
    let s = newGame(pairRow(['a', 'b', 'a', 'b']));
    s = tap(s, 0);
    s = tap(s, 1);
    expect(s.selected).toBe(1);
    expect(s.slots).toEqual([]);
    expect(s.onBoard).toEqual([0, 1, 2, 3]);

    // tile 2 is blocked at both sides, tile 4 sits on top of it
    const b = newGame([
      t(1, 0, 0, 0, 'a'),
      t(2, 2, 0, 0, 'b'),
      t(3, 4, 0, 0, 'a'),
      t(4, 2, 0, 1, 'b'),
      t(5, 20, 0, 0, 'c'),
    ]);
    const sel = tap(b, 5);
    expect(sel.selected).toBe(5);
    expect(tap(sel, 2)).toEqual(sel); // blocked: selection stays
    expect(tap(sel, 1)).toEqual({ ...sel, selected: 1 }); // free: selection moves
    const none = tap(b, 2);
    expect(none.selected).toBe(null);
    expect(none.onBoard).toEqual(b.onBoard);
    expect(tap(sel, 99)).toEqual(sel); // not on the board
  });

  test('a covered tile cannot be selected or sent', () => {
    const s = newGame([t(1, 0, 0, 0, 'a'), t(2, 0, 0, 1, 'b'), t(3, 8, 0, 0, 'a')]);
    const r = send(s, 1);
    expect(r.selected).toBe(null);
    expect(r.slots).toEqual([]);
    expect(r.onBoard).toEqual([1, 2, 3]);
  });

  test('tapElsewhere clears the selection', () => {
    let s = newGame(pairRow(['a', 'b', 'a', 'b']));
    s = tap(s, 2);
    expect(s.selected).toBe(2);
    s = tapElsewhere(s);
    expect(s.selected).toBe(null);
    expect(s.slots).toEqual([]);
    expect(s.onBoard).toEqual([0, 1, 2, 3]);
    // with nothing selected it changes nothing
    expect(tapElsewhere(s)).toEqual(s);
    // after clearing, one tap selects again, it does not send
    s = tap(s, 2);
    expect(s.selected).toBe(2);
    expect(s.slots).toEqual([]);
  });

  test('functions leave the old state unchanged', () => {
    const s0 = newGame(pairRow(['a', 'b', 'a', 'b']));
    const snapshot = structuredClone(s0);
    const s1 = tap(s0, 0);
    const s2 = tap(s1, 0);
    const s1Snapshot = structuredClone(s1);
    const s2Snapshot = structuredClone(s2);
    undo(s2);
    tapElsewhere(s1);
    tap(s2, 1);
    expect(s0).toEqual(snapshot);
    expect(s1).toEqual(s1Snapshot);
    expect(s2).toEqual(s2Snapshot);
    expect(s1.selected).toBe(0);
    expect(s1.history).toEqual([]);
    expect(s2.history).toHaveLength(1);
  });
});

describe('slots', () => {
  test('a pair leaves the slots right away and keeps the order of the rest', () => {
    // faces: 0 a, 1 b, 2 c, 3 b, 4 a, 5 c
    let s = newGame(pairRow(['a', 'b', 'c', 'b', 'a', 'c']));
    s = send(s, 0);
    s = send(s, 1);
    s = send(s, 2);
    expect(s.slots).toEqual([0, 1, 2]);
    s = send(s, 3); // b pairs with the b in the slots
    expect(s.slots).toEqual([0, 2]);
    expect(s.onBoard).toEqual([4, 5]);
    expect(s.selected).toBe(null);
    expect(s.status).toBe('playing');
  });

  test('3 unmatched is fine, a 4th with a pair is fine, a 4th without loses', () => {
    let s = newGame(pairRow(['a', 'b', 'c', 'a', 'd']));
    s = send(s, 0);
    s = send(s, 1);
    s = send(s, 2);
    expect(s.slots).toEqual([0, 1, 2]);
    expect(s.status).toBe('playing');

    const pairs = send(s, 3); // a pairs with a
    expect(pairs.slots).toEqual([1, 2]);
    expect(pairs.status).toBe('playing');

    const loses = send(s, 4); // d pairs with nothing
    expect(loses.slots).toEqual([0, 1, 2, 4]);
    expect(loses.status).toBe('lost');
  });

  test('an empty board with empty slots wins', () => {
    let s = newGame(pairRow(['a', 'a']));
    s = send(s, 0);
    expect(s.status).toBe('playing');
    s = send(s, 1);
    expect(s.onBoard).toEqual([]);
    expect(s.slots).toEqual([]);
    expect(s.status).toBe('won');
  });

  test('after a loss or a win, tap changes nothing', () => {
    let lost = newGame(pairRow(['a', 'b', 'c', 'd', 'a']));
    for (const id of [0, 1, 2, 3]) lost = send(lost, id);
    expect(lost.status).toBe('lost');
    expect(tap(lost, 4)).toEqual(lost);
    expect(send(lost, 4)).toEqual(lost);
    expect(tapElsewhere(lost)).toEqual(lost);

    let won = newGame(pairRow(['a', 'a']));
    won = send(send(won, 0), 1);
    expect(won.status).toBe('won');
    expect(tap(won, 0)).toEqual(won);
    expect(tapElsewhere(won)).toEqual(won);
  });
});

describe('undo', () => {
  test('undo restores the losing move and returns to playing', () => {
    let s = newGame(pairRow(['a', 'b', 'c', 'd', 'a']));
    for (const id of [0, 1, 2]) s = send(s, id);
    const before = s;
    s = send(s, 3);
    expect(s.status).toBe('lost');
    s = undo(s);
    expect(s.status).toBe('playing');
    expect(s.slots).toEqual([0, 1, 2]);
    expect(s.onBoard).toEqual([3, 4]);
    expect(s.selected).toBe(null);
    expect(s).toEqual(before);
    // and the game goes on: tile 4 pairs with tile 0
    expect(send(s, 4).slots).toEqual([1, 2]);
  });

  test('undo after a win returns to playing', () => {
    let s = newGame(pairRow(['a', 'a']));
    s = send(send(s, 0), 1);
    expect(s.status).toBe('won');
    s = undo(s);
    expect(s.status).toBe('playing');
    expect(s.slots).toEqual([0]);
    expect(s.onBoard).toEqual([1]);
  });

  test('undo after a pair puts both tiles back, and the covered tile is covered again', () => {
    const s0 = newGame([t(1, 0, 0, 0, 'a'), t(2, 0, 0, 1, 'b'), t(3, 10, 0, 0, 'b'), t(4, 20, 0, 0, 'a')]);
    let s = send(s0, 3);
    const beforePair = s;
    expect(isCovered(s, 1)).toBe(true);
    s = send(s, 2); // b pairs with b: both leave
    expect(s.slots).toEqual([]);
    expect(s.onBoard).toEqual([1, 4]);
    expect(isCovered(s, 1)).toBe(false);
    expect(isFree(s, 1)).toBe(true);

    s = undo(s);
    expect(s.onBoard).toEqual([1, 2, 4]);
    expect(s.slots).toEqual([3]);
    expect(s).toEqual(beforePair);
    expect(isCovered(s, 1)).toBe(true);
    expect(isFree(s, 1)).toBe(false);
  });

  test('undo with no history changes nothing; repeated undo reaches the start', () => {
    const s0 = newGame(pairRow(['a', 'b', 'c', 'a', 'b', 'c']));
    expect(undo(s0)).toEqual(s0);

    let s = s0;
    for (const id of [0, 1, 2, 3]) s = send(s, id);
    expect(s.history).toHaveLength(4);
    for (let i = 0; i < 4; i++) s = undo(s);
    expect(s).toEqual(s0);
    expect(s.history).toEqual([]);
    expect(undo(s)).toEqual(s0);
  });

  test('a selection alone is not a move: undo does not count it', () => {
    let s = newGame(pairRow(['a', 'b', 'a', 'b']));
    s = send(s, 0);
    s = tap(s, 1);
    expect(s.history).toHaveLength(1);
    s = undo(s);
    expect(s.slots).toEqual([]);
    expect(s.onBoard).toEqual([0, 1, 2, 3]);
    expect(s.selected).toBe(null);
  });
});

describe('the match rule', () => {
  test('any season matches any season, any flower any flower, the rest only themselves', () => {
    for (const season of ['spring', 'summer', 'autumn', 'winter']) expect(matchKey(season)).toBe('season');
    for (const flower of ['plum', 'orchid', 'chrysanthemum', 'rose']) expect(matchKey(flower)).toBe('flower');
    expect(matchKey('cat')).toBe('cat');
    expect(matchKey('circle3')).toBe('circle3');
    expect(matchKey('circle3')).not.toBe(matchKey('circle4'));
  });

  test('spring and winter leave as a pair', () => {
    let s = newGame(pairRow(['spring', 'winter', 'cat', 'cat']));
    s = send(s, 0);
    expect(s.slots).toEqual([0]);
    s = send(s, 1);
    expect(s.slots).toEqual([]);
  });

  test('two flowers leave as a pair', () => {
    const s = send(send(newGame(pairRow(['plum', 'rose'])), 0), 1);
    expect(s.status).toBe('won');
  });

  test('a season and a flower do not pair', () => {
    const s = send(send(newGame(pairRow(['spring', 'plum', 'cat', 'cat'])), 0), 1);
    expect(s.slots).toEqual([0, 1]);
  });

  test('undo restores both tiles of a mixed season pair', () => {
    const start = send(newGame(pairRow(['spring', 'winter', 'cat', 'cat'])), 0);
    const paired = send(start, 1);
    expect(paired.onBoard).toEqual([2, 3]);
    const back = undo(paired);
    expect(back).toEqual(start);
    expect(back.slots).toEqual([0]);
    expect(back.onBoard).toEqual([1, 2, 3]);
    expect(undo(back).onBoard).toEqual([0, 1, 2, 3]);
  });
});

describe('no slots', () => {
  const start = (faces: string[]) => newGame(pairRow(faces), { noSlots: true });

  test('slots games leave the field absent', () => {
    expect('noSlots' in newGame(pairRow(['a', 'a']))).toBe(false);
    expect(start(['a', 'a']).noSlots).toBe(true);
  });

  test('the first tap selects', () => {
    expect(tap(start(['a', 'b', 'a']), 0).selected).toBe(0);
  });

  test('a free non-match moves the selection', () => {
    const s = tap(tap(start(['a', 'b', 'a', 'b']), 0), 1);
    expect(s.selected).toBe(1);
    expect(s.onBoard).toEqual([0, 1, 2, 3]);
    expect(s.history).toEqual([]);
  });

  test('tapping the selected tile again deselects without history', () => {
    const s = tap(tap(start(['a', 'b', 'a']), 0), 0);
    expect(s.selected).toBeNull();
    expect(s.history).toEqual([]);
    expect(s.onBoard).toEqual([0, 1, 2]);
  });

  test('a free match removes both, leaves slots empty, adds one history entry', () => {
    const s0 = start(['a', 'b', 'a', 'b']);
    const s = tap(tap(s0, 0), 2);
    expect(s.onBoard).toEqual([1, 3]);
    expect(s.slots).toEqual([]);
    expect(s.selected).toBeNull();
    expect(s.history).toEqual([{ onBoard: [0, 1, 2, 3], slots: [] }]);
    expect(s.status).toBe('playing');
  });

  test('a season pairs with a different season', () => {
    const s = tap(tap(start(['spring', 'winter', 'cat', 'cat']), 0), 1);
    expect(s.onBoard).toEqual([2, 3]);
  });

  test('clearing the board wins', () => {
    expect(tap(tap(start(['a', 'a']), 0), 1).status).toBe('won');
  });

  test('a removal leaving tiles but no free pair loses, and undo restores both', () => {
    const s0 = start(['a', 'a', 'b', 'c']);
    const lost = tap(tap(s0, 0), 1);
    expect(lost.onBoard).toEqual([2, 3]);
    expect(freePairs(lost)).toEqual([]);
    expect(lost.status).toBe('lost');
    const back = undo(lost);
    expect(back.status).toBe('playing');
    expect(back.onBoard).toEqual([0, 1, 2, 3]);
  });

  test('freePairs lists free matching pairs in onBoard order', () => {
    const s = start(['a', 'b', 'a', 'b', 'c']);
    expect(freePairs(s)).toEqual([[0, 2], [1, 3]]);
  });

  test('freePairs skips covered tiles', () => {
    const s = newGame([t(0, 0, 0, 0, 'a'), t(1, 0, 0, 1, 'b'), t(2, 8, 0, 0, 'a')], { noSlots: true });
    expect(freePairs(s)).toEqual([]);
  });
});
