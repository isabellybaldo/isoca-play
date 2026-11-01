// Backtracking helpers for tests only. Cells are indexed 0..80, '.' is empty.

function candidates(grid: number[], cell: number): number[] {
  const r = Math.floor(cell / 9);
  const c = cell % 9;
  const used = new Set<number>();
  for (let i = 0; i < 9; i++) {
    used.add(grid[r * 9 + i]);
    used.add(grid[i * 9 + c]);
  }
  const br = r - (r % 3);
  const bc = c - (c % 3);
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) used.add(grid[(br + dr) * 9 + bc + dc]);
  }
  const out: number[] = [];
  for (let d = 1; d <= 9; d++) if (!used.has(d)) out.push(d);
  return out;
}

function parse(givens: string): number[] {
  return [...givens].map((ch) => (ch === '.' ? 0 : Number(ch)));
}

function search(grid: number[], limit: number, found: number[][]): void {
  let best = -1;
  let bestCands: number[] = [];
  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) continue;
    const cs = candidates(grid, i);
    if (best === -1 || cs.length < bestCands.length) {
      best = i;
      bestCands = cs;
      if (cs.length === 0) return;
    }
  }
  if (best === -1) {
    found.push([...grid]);
    return;
  }
  for (const d of bestCands) {
    grid[best] = d;
    search(grid, limit, found);
    grid[best] = 0;
    if (found.length >= limit) return;
  }
}

export function countSolutions(givens: string, limit = 2): number {
  const found: number[][] = [];
  search(parse(givens), limit, found);
  return found.length;
}

export function solve(givens: string): string | null {
  const found: number[][] = [];
  search(parse(givens), 1, found);
  return found.length ? found[0].join('') : null;
}
