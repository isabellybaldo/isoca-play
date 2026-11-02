import { describe, expect, test } from 'vitest';
import { blanked } from '../fakeServer.testutil';
import type { MahjongState, Tile } from '../mahjong/rules';
import { newSolitaire, type SolitaireState } from '../solitaire/rules';
import { newSudoku, type SudokuState } from '../sudoku/rules';
import type { MahjongSave } from '../useSavedGame';
import { isRun, track, type Run, type Tick } from './run';

let ids = 0;
const tick = (over: Partial<Tick> = {}): Tick => ({ today: '2026-11-02', seconds: 0, tips: 0, newId: () => `id-${++ids}`, ...over });

const TILES: Tile[] = [{ id: 0, x: 0, y: 0, z: 0, face: 'cat' }];
const board = (over: Partial<MahjongState> = {}): MahjongState =>
  ({ tiles: TILES, onBoard: [0], slots: [], selected: null, history: [], status: 'playing', ...over }) as MahjongState;
const mj = (over: Partial<MahjongState> = {}, run?: Run): MahjongSave => ({ layout: 'fort', state: board(over), ...(run ? { run } : {}) });
const step = { onBoard: [], slots: [] };

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1', seconds: 0, returns: 0, tips: 0, days: ['2026-11-01'], unsolved: 0, turns: 0, done: false, ...over,
});

const PUZZLE = blanked('hard', [0, 1, 2]);
const sudoku = (over: Partial<SudokuState> = {}, r?: Run): SudokuState => ({ ...newSudoku(PUZZLE), ...over, ...(r ? { run: r } : {}) });
const DEAL = Array.from({ length: 52 }, (_, i) => i);
const solitaire = (over: Partial<SolitaireState> = {}, r?: Run): SolitaireState => ({ ...newSolitaire(DEAL), ...over, ...(r ? { run: r } : {}) });

describe('a new deal', () => {
  test('gets a run; replaced with no moves it records nothing', () => {
    const first = track('mahjong', null, mj(), tick());
    expect(first.records).toEqual([]);
    expect(isRun(first.save!.run)).toBe(true);
    expect(first.save!.run!.days).toEqual([]);
    const other = { ...mj(), state: board({ tiles: [...TILES] }) };
    const second = track('mahjong', first.save, other, tick());
    expect(second.records).toEqual([]);
    expect(second.save!.run!.id).not.toBe(first.save!.run!.id);
  });

  test('a game with moves replaced is abandoned, with what it counted', () => {
    const prev = mj({ history: [step] }, run({ returns: 2, tips: 1, seconds: 60 }));
    const { records, spent } = track('mahjong', prev, { ...mj(), state: board({ tiles: [...TILES] }) }, tick({ seconds: 5.4, tips: 1 }));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'r1', game: 'mahjong', level: 'hard', result: 'abandoned', day: '2026-11-02', days: ['2026-11-01'],
      seconds: 65, returns: 2, tips: 2, map: 'fort', slots: true, moves: 1, unsolved: null, turns: null,
    });
    expect(spent).toBe(true);
  });

  test('a game replaced with null is abandoned too', () => {
    const { records, save } = track('sudoku', sudoku({}, run()), null, tick());
    expect(records.map((r) => r.result)).toEqual(['abandoned']);
    expect(save).toBeNull();
  });

  test('stuck, then replaced, is lost', () => {
    const prev = mj({ history: [step], status: 'lost' }, run());
    const { records } = track('mahjong', prev, null, tick());
    expect(records.map((r) => r.result)).toEqual(['lost']);
  });
});

describe('moves and Returns', () => {
  test('the first move adds today once; a move on another day adds that day', () => {
    let save = track('sudoku', sudoku({}, run({ days: [] })), sudoku({ history: [{ cell: 0, value: 0, notes: 0 }] }, run({ days: [] })), tick()).save!;
    expect(save.run!.days).toEqual(['2026-11-02']);
    const again = { ...save, history: [...save.history, { cell: 1, value: 0, notes: 0 }] };
    save = track('sudoku', save, again, tick()).save!;
    expect(save.run!.days).toEqual(['2026-11-02']);
    const later = { ...save, history: [...save.history, { cell: 2, value: 0, notes: 0 }] };
    save = track('sudoku', save, later, tick({ today: '2026-11-03' })).save!;
    expect(save.run!.days).toEqual(['2026-11-02', '2026-11-03']);
  });

  test('a Return counts, and playing on does not undo the count', () => {
    const start = mj({ history: [step] }, run());
    const back = track('mahjong', start, { ...start, state: { ...start.state, history: [] } }, tick()).save!;
    expect(back.run!.returns).toBe(1);
    const on = track('mahjong', back, { ...back, state: { ...back.state, history: [step] } }, tick()).save!;
    expect(on.run!.returns).toBe(1);
  });

  test('time and tips go in with a move, and spent says so', () => {
    const start = mj({}, run({ seconds: 10, tips: 1 }));
    const { save, spent } = track('mahjong', start, { ...start, state: { ...start.state, history: [step] } }, tick({ seconds: 5, tips: 2 }));
    expect(save!.run).toMatchObject({ seconds: 15, tips: 3 });
    expect(spent).toBe(true);
  });

  test('a selection or mode switch returns the same object and spends nothing', () => {
    const start = sudoku({}, run());
    const next = { ...start, selected: 4 };
    const result = track('sudoku', start, next, tick({ seconds: 5, tips: 1 }));
    expect(result.save).toBe(next);
    expect(result.spent).toBe(false);
    expect(result.records).toEqual([]);
  });

  test('sudoku counts each time the board comes out unsolved', () => {
    const start = sudoku({}, run());
    const entry = { cell: 0, value: 0, notes: 0 };
    const wrong = track('sudoku', start, { ...start, history: [entry], status: 'unsolved' }, tick()).save!;
    expect(wrong.run!.unsolved).toBe(1);
    const still = track('sudoku', wrong, { ...wrong, history: [entry, entry], status: 'unsolved' }, tick()).save!;
    expect(still.run!.unsolved).toBe(1);
    const back = track('sudoku', still, { ...still, history: [entry], status: 'playing' }, tick()).save!;
    const again = track('sudoku', back, { ...back, history: [entry, entry], status: 'unsolved' }, tick()).save!;
    expect(again.run!.unsolved).toBe(2);
  });

  test('solitaire counts each turn of the pile', () => {
    const start = solitaire({ history: ['d'] }, run());
    const turned = track('solitaire', start, { ...start, history: ['d', 'r'] }, tick()).save!;
    expect(turned.run!.turns).toBe(1);
    const drawn = track('solitaire', turned, { ...turned, history: ['d', 'r', 'd'] }, tick()).save!;
    expect(drawn.run!.turns).toBe(1);
  });
});

describe('a win', () => {
  const winning = (start: MahjongSave) => ({ ...start, state: { ...start.state, history: [step], status: 'won' as const } });

  test('records once, with its level, map, slots and moves', () => {
    const start = mj({}, run());
    const { records, save } = track('mahjong', start, winning(start), tick({ seconds: 3 }));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ result: 'won', level: 'hard', map: 'fort', slots: true, moves: 1, seconds: 3, days: ['2026-11-01', '2026-11-02'] });
    expect(save!.run!.done).toBe(true);
  });

  test('no slots is reported', () => {
    const start = mj({ noSlots: true }, run());
    expect(track('mahjong', start, winning(start), tick()).records[0].slots).toBe(false);
  });

  test('a Return, more play and replacing it make no second record', () => {
    const start = mj({}, run());
    const won = track('mahjong', start, winning(start), tick()).save!;
    const back = track('mahjong', won, { ...won, state: { ...won.state, history: [], status: 'playing' } }, tick());
    expect(back.records).toEqual([]);
    const again = track('mahjong', back.save, winning(back.save!), tick());
    expect(again.records).toEqual([]);
    expect(track('mahjong', again.save, null, tick()).records).toEqual([]);
    expect(track('mahjong', back.save, null, tick()).records).toEqual([]);
  });

  test('stuck, Return, then won is one win', () => {
    const start = mj({ history: [step], status: 'lost' }, run());
    const back = track('mahjong', start, { ...start, state: { ...start.state, history: [], status: 'playing' } }, tick()).save!;
    const { records } = track('mahjong', back, winning(back), tick());
    expect(records.map((r) => r.result)).toEqual(['won']);
    expect(records[0].returns).toBe(1);
  });

  test('solitaire records a null level; sudoku its puzzle level', () => {
    const cards = solitaire({}, run());
    expect(track('solitaire', cards, { ...cards, history: ['d'], status: 'won' }, tick()).records[0]).toMatchObject({ level: null, map: null, turns: 0, unsolved: null, moves: null });
    const grid = sudoku({}, run());
    const entry = { cell: 0, value: 0, notes: 0 };
    expect(track('sudoku', grid, { ...grid, history: [entry], status: 'won' }, tick()).records[0]).toMatchObject({ level: 'hard', unsolved: 0, turns: null });
  });
});

describe('a save with no good run', () => {
  test.each([
    ['none', undefined],
    ['malformed', { id: 7 }],
    ['days not a list', { ...run(), days: 'x' }],
  ])('%s plays on and is never recorded', (_name, bad) => {
    const start = { ...mj({ history: [step] }), run: bad } as MahjongSave;
    const next = { ...start, state: { ...start.state, history: [step, step], status: 'won' as const } };
    const moved = track('mahjong', start, next, tick({ seconds: 4 }));
    expect(moved.save).toBe(next);
    expect(moved.records).toEqual([]);
    expect(moved.spent).toBe(false);
    expect(track('mahjong', start, null, tick()).records).toEqual([]);
  });
});
