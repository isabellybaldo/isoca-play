import { ApiError, sendGameRecord } from '../api';
import { OUTBOX_KEY } from '../offline';
import type { GameRecord } from './run';

export { OUTBOX_KEY };

const LIMIT = 500;
// The server will answer these the same way however often it is asked.
const REFUSED = new Set([400, 413]);

// Finished games wait here until the server has them. All of it is quiet: with storage
// denied nothing is recorded, and a game never hears of any of this.
function read(): GameRecord[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
    if (!Array.isArray(kept)) return [];
    return kept.filter((r): r is GameRecord => typeof r === 'object' && r !== null && typeof r.id === 'string');
  } catch {
    return [];
  }
}

function write(records: GameRecord[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(records));
  } catch {
    // Nothing kept, nothing lost but a count.
  }
}

export function addRecords(records: GameRecord[]): void {
  if (records.length === 0) return;
  const kept = read();
  const known = new Set(kept.map((r) => r.id));
  write([...kept, ...records.filter((r) => !known.has(r.id))].slice(-LIMIT));
}

let sending: Promise<void> | null = null;

// Oldest first, until the server stops taking them. The next load or reconnect tries again.
async function sendAll(): Promise<void> {
  for (let next = read()[0]; next; next = read()[0]) {
    try {
      await sendGameRecord(next);
    } catch (error) {
      if (!(error instanceof ApiError && REFUSED.has(error.status))) return;
    }
    write(read().filter((r) => r.id !== next.id));
  }
}

export function sendRecords(): Promise<void> {
  sending ??= sendAll().finally(() => {
    sending = null;
  });
  return sending;
}
