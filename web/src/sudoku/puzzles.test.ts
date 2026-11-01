import { describe, expect, test } from 'vitest';
import { PUZZLES } from './puzzles';
import { countSolutions, solve } from './solver.testutil';
import type { Level } from '../mahjong/layouts';

const countGivens = (g: string) => [...g].filter((ch) => ch !== '.').length;

describe('starter puzzles', () => {
  test('there are three per level', () => {
    for (const level of ['easy', 'medium', 'hard'] as Level[]) {
      expect(PUZZLES.filter((p) => p.level === level)).toHaveLength(3);
    }
  });

  test.each(PUZZLES)('$level puzzle has one solution and matches it', (p) => {
    expect(p.givens).toHaveLength(81);
    expect(countSolutions(p.givens, 2)).toBe(1);
    expect(solve(p.givens)).toBe(p.solution);
  });

  test.each(PUZZLES)('$level puzzle givens agree with its solution', (p) => {
    for (let i = 0; i < 81; i++) {
      if (p.givens[i] !== '.') expect(p.givens[i]).toBe(p.solution[i]);
    }
  });

  test('harder levels give fewer numbers on average', () => {
    const avg = (level: Level) => {
      const ps = PUZZLES.filter((p) => p.level === level);
      return ps.reduce((n, p) => n + countGivens(p.givens), 0) / ps.length;
    };
    expect(avg('easy')).toBeGreaterThan(avg('medium'));
    expect(avg('medium')).toBeGreaterThan(avg('hard'));
  });
});
