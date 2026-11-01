import { useState } from 'react';
import ConfirmDialog from '../ConfirmDialog';
import type { Level } from '../mahjong/layouts';
import { PUZZLES } from './puzzles';
import { newSudoku, pressDigit, selectCell, setMode, undo, type Puzzle, type SudokuState } from './rules';
import './sudoku.css';

const LEVELS: { id: Level; name: string; line: string }[] = [
  { id: 'easy', name: 'Easy', line: 'Many numbers given. The simple rules are enough.' },
  { id: 'medium', name: 'Medium', line: 'Fewer numbers given.' },
  { id: 'hard', name: 'Hard', line: 'Few numbers given. Needs the harder sudoku rules.' },
];

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// A puzzle of the level, never the one in play unless it is the only one.
function pick(level: Level, current?: Puzzle): Puzzle {
  const all = PUZZLES.filter((p) => p.level === level);
  const others = all.filter((p) => p !== current);
  const pool = others.length > 0 ? others : all;
  return pool[Math.floor(Math.random() * pool.length)];
}

// What the square says to a screen reader: what it holds, never whether that is right.
function describe(state: SudokuState, cell: number): string {
  const place = `Row ${Math.floor(cell / 9) + 1}, column ${(cell % 9) + 1}`;
  if (state.puzzle.givens[cell] !== '.') return `${place}, given ${state.values[cell]}`;
  if (state.values[cell] !== 0) return `${place}, written ${state.values[cell]}`;
  const noted = DIGITS.filter((d) => state.notes[cell] & (1 << (d - 1)));
  return noted.length > 0 ? `${place}, notes ${noted.join(' ')}` : `${place}, empty`;
}

function Cell({ state, cell, onSelect }: { state: SudokuState; cell: number; onSelect: (cell: number) => void }) {
  const given = state.puzzle.givens[cell] !== '.';
  const value = state.values[cell];
  const selected = state.selected === cell;
  const col = cell % 9;
  const row = Math.floor(cell / 9);
  const classes = ['cell'];
  if (given) classes.push('is-given');
  else if (value !== 0) classes.push('is-written');
  if (selected) classes.push('is-selected');
  const style = {
    borderRightWidth: col === 8 ? 0 : col % 3 === 2 ? 3 : 1,
    borderBottomWidth: row === 8 ? 0 : row % 3 === 2 ? 3 : 1,
    borderRightColor: col % 3 === 2 ? 'var(--line)' : undefined,
    borderBottomColor: row % 3 === 2 ? 'var(--line)' : undefined,
  };

  return (
    <button
      type="button"
      className={classes.join(' ')}
      style={style}
      aria-label={describe(state, cell)}
      aria-pressed={selected}
      onClick={() => onSelect(cell)}
    >
      {value !== 0 ? (
        <span className="value">{value}</span>
      ) : state.notes[cell] !== 0 ? (
        <span className="notes" aria-hidden="true">
          {DIGITS.map((d) => {
            const on = (state.notes[cell] & (1 << (d - 1))) !== 0;
            return (
              <span key={d} className={on ? 'note-on' : undefined}>
                {on ? d : ''}
              </span>
            );
          })}
        </span>
      ) : null}
    </button>
  );
}

function Game({ level, onLevels }: { level: Level; onLevels: () => void }) {
  const [state, setState] = useState(() => newSudoku(pick(level)));
  const [asking, setAsking] = useState(false);
  const won = state.status === 'won';
  const deal = () => setState((s) => newSudoku(pick(level, s.puzzle)));
  const name = LEVELS.find((l) => l.id === level)!.name;

  return (
    <>
      <main className="shell sd-game" inert={asking}>
        <div className="sd-bar">
          <button type="button" className="back" aria-label="Back to levels" onClick={onLevels}>Back</button>
          <span className="sd-level">{name}</span>
          <button
            type="button"
            className="back"
            onClick={() => {
              if (won) deal();
              else setAsking(true);
            }}
          >
            New game
          </button>
        </div>

        <div className="sd-board" role="group" aria-label="Board">
          {state.values.map((_, cell) => (
            <Cell key={cell} state={state} cell={cell} onSelect={(c) => setState((s) => selectCell(s, c))} />
          ))}
        </div>

        <div role="status" className="sd-note">
          {state.status === 'won' ? 'You won.' : state.status === 'unsolved' ? 'Not solved.' : ''}
        </div>

        <div className="sd-controls">
          <div className="sd-modes" role="group" aria-label="Mode">
            <button
              type="button"
              className="sd-mode"
              aria-pressed={state.mode === 'write'}
              onClick={() => setState((s) => setMode(s, 'write'))}
            >
              Write
            </button>
            <button
              type="button"
              className="sd-mode"
              aria-pressed={state.mode === 'notes'}
              onClick={() => setState((s) => setMode(s, 'notes'))}
            >
              Notes
            </button>
          </div>
          <button
            type="button"
            className="back"
            disabled={state.history.length === 0 || won}
            onClick={() => setState((s) => undo(s))}
          >
            Return
          </button>
        </div>

        <div className={state.mode === 'notes' ? 'sd-pad is-notes' : 'sd-pad'} role="group" aria-label="Numbers">
          {DIGITS.map((d) => (
            <button key={d} type="button" onClick={() => setState((s) => pressDigit(s, d))}>
              {d}
            </button>
          ))}
        </div>
      </main>

      {asking && (
        <ConfirmDialog
          title="Start a new game?"
          line="This game will be lost."
          keepLabel="Keep playing"
          confirmLabel="Start new game"
          onKeep={() => setAsking(false)}
          onConfirm={() => {
            deal();
            setAsking(false);
          }}
        />
      )}
    </>
  );
}

export default function SudokuGame({ onBack }: { onBack: () => void }) {
  const [level, setLevel] = useState<Level | null>(null);

  if (level) return <Game level={level} onLevels={() => setLevel(null)} />;
  return (
    <main className="shell sd-setup">
      <button type="button" className="back" onClick={onBack}>Back to home</button>
      <h1 className="sd-title">Sudoku</h1>
      <div className="sd-levels" role="group" aria-label="Difficulty">
        {LEVELS.map((l) => (
          <button key={l.id} type="button" className="sd-levelbtn" aria-label={l.name} onClick={() => setLevel(l.id)}>
            <span className="sd-levelname">{l.name}</span>
            <span className="sd-levelline">{l.line}</span>
          </button>
        ))}
      </div>
      <p className="sd-hint">Tap a level to start.</p>
    </main>
  );
}
