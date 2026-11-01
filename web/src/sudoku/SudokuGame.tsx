import { useState, type SetStateAction } from 'react';
import { newGameProblem, newSudoku as askForPuzzle, REPLACE_UNPLAYABLE, startNote } from '../api';
import ConfirmDialog from '../ConfirmDialog';
import type { Level } from '../mahjong/layouts';
import ResumeButton from '../ResumeButton';
import { hasMovesToLose, newSudoku, pressDigit, selectCell, setMode, undo, type SudokuState } from './rules';
import './sudoku.css';

const LEVELS: { id: Level; name: string; line: string }[] = [
  { id: 'easy', name: 'Easy', line: 'Most numbers given.' },
  { id: 'medium', name: 'Medium', line: 'Fewer numbers given.' },
  { id: 'hard', name: 'Hard', line: 'Fewest numbers given.' },
];

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

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

function Game({
  state,
  onChange,
  online,
  onLevels,
}: {
  state: SudokuState;
  onChange: (update: (s: SudokuState) => SudokuState) => void;
  online: boolean;
  onLevels: () => void;
}) {
  const level = state.puzzle.level;
  const [asking, setAsking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState('');
  const deal = async () => {
    setStarting(true);
    setProblem('');
    try {
      const next = newSudoku(await askForPuzzle(level, state.puzzle.givens));
      onChange(() => next);
    } catch (error) {
      setProblem(newGameProblem(error));
    } finally {
      setStarting(false);
    }
  };
  const note = startNote({ online, starting, problem });
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
            disabled={!online || starting}
            onClick={() => {
              if (hasMovesToLose(state)) setAsking(true);
              else void deal();
            }}
          >
            New game
          </button>
        </div>

        <div className="sd-board" role="group" aria-label="Board">
          {state.values.map((_, cell) => (
            <Cell key={cell} state={state} cell={cell} onSelect={(c) => onChange((s) => selectCell(s, c))} />
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
              onClick={() => onChange((s) => setMode(s, 'write'))}
            >
              Write
            </button>
            <button
              type="button"
              className="sd-mode"
              aria-pressed={state.mode === 'notes'}
              onClick={() => onChange((s) => setMode(s, 'notes'))}
            >
              Notes
            </button>
          </div>
          <button
            type="button"
            className="back"
            disabled={state.history.length === 0}
            onClick={() => onChange(undo)}
          >
            Return
          </button>
        </div>

        <div className={state.mode === 'notes' ? 'sd-pad is-notes' : 'sd-pad'} role="group" aria-label="Numbers">
          {DIGITS.map((d) => (
            <button key={d} type="button" onClick={() => onChange((s) => pressDigit(s, d))}>
              {d}
            </button>
          ))}
        </div>
        {note && <p className="start-note" aria-live="polite">{note}</p>}
      </main>

      {asking && (
        <ConfirmDialog
          title="Start a new game?"
          line="This game will be lost."
          keepLabel="Keep playing"
          confirmLabel="Start new game"
          onKeep={() => setAsking(false)}
          onConfirm={() => {
            void deal();
            setAsking(false);
          }}
        />
      )}
    </>
  );
}

export default function SudokuGame({
  game,
  onGame,
  ready = true,
  online = true,
  unplayable = false,
  onBack,
}: {
  game: SudokuState | null;
  onGame: (action: SetStateAction<SudokuState | null>) => void;
  ready?: boolean;
  online?: boolean;
  unplayable?: boolean;
  onBack: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [replacing, setReplacing] = useState<Level | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState('');

  if (playing && game) {
    return (
      <Game
        state={game}
        onChange={(update) => onGame((g) => g && update(g))}
        online={online}
        onLevels={() => setPlaying(false)}
      />
    );
  }

  const start = async (level: Level) => {
    setStarting(true);
    setProblem('');
    try {
      onGame(newSudoku(await askForPuzzle(level, game?.puzzle.givens)));
      setPlaying(true);
    } catch (error) {
      setProblem(newGameProblem(error));
    } finally {
      setStarting(false);
    }
  };
  const note = startNote({ online, ready, starting, problem, unplayable });
  return (
    <>
      <main className="shell sd-setup" inert={replacing !== null}>
        <button type="button" className="back" onClick={onBack}>Back to home</button>
        <h1 className="sd-title">Sudoku</h1>
        {game && (
          <ResumeButton
            name={LEVELS.find((l) => l.id === game.puzzle.level)!.name}
            moves={game.history.length}
            onResume={() => setPlaying(true)}
          />
        )}
        <div className="sd-levels" role="group" aria-label="Difficulty">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              className="sd-levelbtn"
              aria-label={l.name}
              disabled={!online || !ready || starting}
              onClick={() => (unplayable || (game && hasMovesToLose(game)) ? setReplacing(l.id) : void start(l.id))}
            >
              <span className="sd-levelname">{l.name}</span>
              <span className="sd-levelline">{l.line}</span>
            </button>
          ))}
        </div>
        <p className="sd-hint">Tap a level to start.</p>
        {note && <p className="start-note" aria-live="polite">{note}</p>}
      </main>

      {replacing && (
        <ConfirmDialog
          title="Start a new game?"
          line={unplayable ? REPLACE_UNPLAYABLE : 'This game will be lost.'}
          keepLabel="Keep playing"
          confirmLabel="Start new game"
          onKeep={() => {
            setReplacing(null);
            if (game) setPlaying(true);
          }}
          onConfirm={() => {
            void start(replacing);
            setReplacing(null);
          }}
        />
      )}
    </>
  );
}
