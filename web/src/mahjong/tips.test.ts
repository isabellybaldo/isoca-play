import { describe, expect, test } from 'vitest';
import { newGame, tap, type MahjongState, type Tile } from './rules';
import { mahjongTip } from './tips';

const t = (id: number, x: number, y: number, z: number, face: string): Tile => ({ id, x, y, z, face });
const row = (faces: string[]): Tile[] => faces.map((face, i) => t(i, i * 4, 0, 0, face));
const send = (s: MahjongState, id: number): MahjongState => tap(tap(s, id), id);

describe('mahjongTip', () => {
  test('rule 1: a free tile that pairs with a slot tile', () => {
    // star1 goes to a slot; the second star1 is free on the board.
    const s = send(newGame(row(['star1', 'frog', 'star1', 'cat'])), 0);
    const tip = mahjongTip(s);
    expect(tip.tiles).toEqual([2]);
    expect(tip.line).toBe('This pairs with the moon in your slots.');
  });

  test('rule 1 takes a season for a season', () => {
    const s = send(newGame(row(['spring', 'frog', 'winter', 'cat'])), 0);
    expect(mahjongTip(s).tiles).toEqual([2]);
  });

  test('rule 2: three slots full and no slot match sends nothing and points to Return', () => {
    let s = newGame(row(['a', 'b', 'c', 'x', 'x']));
    s = send(send(send(s, 0), 1), 2);
    expect(s.slots).toHaveLength(3);
    const tip = mahjongTip(s); // x and x are a free pair, yet sending either loses
    expect(tip.tiles).toEqual([]);
    expect(tip.line).toMatch(/Return/);
  });

  test('rule 1 still wins with three slots full', () => {
    let s = newGame(row(['a', 'b', 'c', 'a']));
    s = send(send(send(s, 0), 1), 2);
    expect(mahjongTip(s).tiles).toEqual([3]);
  });

  test('rule 3: a free pair highlights both', () => {
    const tip = mahjongTip(newGame(row(['a', 'b', 'a', 'c'])));
    expect(tip.tiles).toEqual([0, 2]);
    expect(tip.line).toMatch(/^Both are open and they match\./);
  });

  test('rule 3 with two slots full is still offered', () => {
    let s = newGame(row(['p', 'q', 'a', 'a']));
    s = send(send(s, 0), 1);
    expect(mahjongTip(s).tiles).toEqual([2, 3]);
  });

  test('rule 4: with no pair open, the free tile that frees the most, ties to the earliest', () => {
    // 0 and 1 are free on layer 0 and each is covered by nothing; tile 4 on top of 3 and 5.
    const tiles = [
      t(0, 0, 0, 0, 'a'), // free, frees nothing
      t(1, 6, 0, 0, 'b'), // covered by 4
      t(2, 8, 0, 0, 'c'), // covered by 4
      t(3, 7, 0, 1, 'd'), // free; lifting it uncovers 1 and 2
      t(4, 20, 0, 0, 'e'),
    ];
    const s = newGame(tiles);
    const tip = mahjongTip(s);
    expect(tip.tiles).toEqual([3]);
    expect(tip.line).toMatch(/^No open pair/);
    expect(tip.line).toMatch(/2/);
  });

  test('rule 4 ties go to the earliest in onBoard', () => {
    const tip = mahjongTip(newGame(row(['a', 'b', 'c'])));
    expect(tip.tiles).toEqual([0]);
  });

  test('rule 4 with no free tile gives no tiles and points to Return', () => {
    const s: MahjongState = { ...newGame(row(['a'])), onBoard: [] };
    const tip = mahjongTip(s);
    expect(tip.tiles).toEqual([]);
    expect(tip.line).toMatch(/Return/);
  });

  test('no slots: only the free pair rule, and the line speaks of tapping', () => {
    const s = newGame(row(['a', 'b', 'a']), { noSlots: true });
    const tip = mahjongTip(s);
    expect(tip.tiles).toEqual([0, 2]);
    expect(tip.line).not.toMatch(/slot/i);
  });

  test('slots line says to send them one after the other', () => {
    expect(mahjongTip(newGame(row(['a', 'a']))).line).toMatch(/one after the other/);
  });

  test('the face of a covered tile never changes the answer or the words', () => {
    const base = (face: string) => [
      t(0, 0, 0, 0, face), // covered by 2
      t(1, 6, 0, 0, 'x'),
      t(2, 1, 0, 1, 'y'), // free
      t(3, 20, 0, 0, 'z'),
    ];
    const a = mahjongTip(newGame(base('x')));
    const b = mahjongTip(newGame(base('q')));
    expect(b).toEqual(a);
  });
});
