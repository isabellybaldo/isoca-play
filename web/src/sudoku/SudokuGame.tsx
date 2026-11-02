import { useState, type SetStateAction } from 'react';
import { newGameProblem, newSudoku as askForPuzzle, REPLACE_UNPLAYABLE, startNote } from '../api';
import ConfirmDialog from '../ConfirmDialog';
import type { Level } from '../mahjong/layouts';
import ResumeButton from '../ResumeButton';
import { useOnScreen, type Tracker } from '../stats/useTracked';
import { glowOf, hasMovesToLose, newSudoku, pressDigit, selectCell, setMode, undo, wrongCells, type SudokuState } from './rules';
import { tipChain, type TipStep } from './tips';
import './sudoku.css';

const LEVELS: { id: Level; name: string; line: string }[] = [
  { id: 'easy', name: 'Easy', line: 'Most numbers given.' },
  { id: 'medium', name: 'Medium', line: 'Fewer numbers given.' },
  { id: 'hard', name: 'Hard', line: 'Fewest numbers given.' },
];

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// What the square says to a screen reader: what it holds, never whether that is right. Only
// while a tip is open, because the player asked, does it add ", tip" or ", wrong".
function describe(state: SudokuState, cell: number, mark: Mark): string {
  const place = `Row ${Math.floor(cell / 9) + 1}, column ${(cell % 9) + 1}`;
  const tail = (mark.lit ? ', tip' : '') + (mark.wrong ? ', wrong' : '');
  if (state.puzzle.givens[cell] !== '.') return `${place}, given ${state.values[cell]}${tail}`;
  if (state.values[cell] !== 0) return `${place}, written ${state.values[cell]}${tail}`;
  const noted = DIGITS.filter((d) => state.notes[cell] & (1 << (d - 1)));
  return (noted.length > 0 ? `${place}, notes ${noted.join(' ')}` : `${place}, empty`) + tail;
}

// What an open tip draws in one square. None of it is in the game's state.
type Mark = { lit: boolean; wrong: boolean; cuts: number[]; placed: number | null };

// A tip is a view of the board it was asked on; any change to the numbers or notes ends it.
type TipView = { kind: 'wrong' } | { kind: 'none' } | { kind: 'steps'; steps: TipStep[]; at: number };
type Tip = { values: number[]; notes: number[]; history: SudokuState['history']; view: TipView };

function marksFor(view: TipView | null, wrong: number[]): Mark[] {
  const marks: Mark[] = Array.from({ length: 81 }, () => ({ lit: false, wrong: false, cuts: [], placed: null }));
  if (view?.kind === 'wrong') for (const c of wrong) marks[c].wrong = true;
  if (view?.kind === 'steps') {
    const step = view.steps[view.at];
    for (const c of step.cells) marks[c].lit = true;
    for (const { cell, digit } of step.removes) marks[cell].cuts.push(digit);
    if (step.places) {
      marks[step.places.cell].lit = true;
      marks[step.places.cell].placed = step.places.digit;
    }
  }
  return marks;
}

function Cell({
  state,
  cell,
  mark,
  onSelect,
}: {
  state: SudokuState;
  cell: number;
  mark: Mark;
  onSelect: (cell: number) => void;
}) {
  const given = state.puzzle.givens[cell] !== '.';
  const value = state.values[cell];
  const selected = state.selected === cell;
  const col = cell % 9;
  const row = Math.floor(cell / 9);
  const classes = ['cell'];
  if (given) classes.push('is-given');
  else if (value !== 0) classes.push('is-written');
  if (selected) classes.push('is-selected');
  const glow = glowOf(state, cell);
  if (glow) classes.push(`is-${glow}`);
  if (mark.lit) classes.push('is-tip');
  if (mark.wrong) classes.push('is-wrong');
  if (mark.placed !== null) classes.push('is-placed');
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
      aria-label={describe(state, cell, mark)}
      aria-pressed={selected}
      onClick={() => onSelect(cell)}
    >
      {value !== 0 ? (
        <span className="value">{value}</span>
      ) : mark.placed !== null ? (
        <span className="tip-digit" aria-hidden="true">{mark.placed}</span>
      ) : mark.cuts.length > 0 ? (
        <span className="notes" aria-hidden="true">
          {DIGITS.map((d) => (
            <span key={d} className={mark.cuts.includes(d) ? 'tip-cut' : undefined}>
              {mark.cuts.includes(d) ? d : ''}
            </span>
          ))}
        </span>
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
  tracker,
}: {
  state: SudokuState;
  onChange: (update: (s: SudokuState) => SudokuState) => void;
  online: boolean;
  onLevels: () => void;
  tracker?: Tracker;
}) {
  useOnScreen(tracker);
  const level = state.puzzle.level;
  const [asking, setAsking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState('');
  const [tip, setTip] = useState<Tip | null>(null);
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

  const view =
    tip && tip.values === state.values && tip.notes === state.notes && tip.history === state.history ? tip.view : null;
  const marks = marksFor(view, view ? wrongCells(state) : []);
  const showTip = (v: TipView) => setTip({ values: state.values, notes: state.notes, history: state.history, view: v });
  // Worked out here, on the tap, never on a render.
  const ask = () => {
    tracker?.tip();
    if (wrongCells(state).length > 0) return showTip({ kind: 'wrong' });
    const steps = tipChain(state.values);
    showTip(steps.length > 0 ? { kind: 'steps', steps, at: 0 } : { kind: 'none' });
  };
  const text =
    view?.kind === 'wrong'
      ? 'Fix the wrong numbers first.'
      : view?.kind === 'none'
        ? 'No tip for this board.'
        : view?.kind === 'steps'
          ? view.steps[view.at].because
          : state.status === 'won'
            ? 'You won.'
            : state.status === 'unsolved'
              ? 'Not solved.'
              : '';

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
            <Cell key={cell} state={state} cell={cell} mark={marks[cell]} onSelect={(c) => onChange((s) => selectCell(s, c))} />
          ))}
        </div>

        <div role="status" className={view ? 'sd-note sd-tip' : 'sd-note'}>
          {text}
        </div>
        {view && (
          <div className="sd-tipbtns">
            {view.kind === 'steps' && view.at < view.steps.length - 1 && (
              <button
                type="button"
                className="back"
                onClick={() => setTip({ ...tip!, view: { ...view, at: view.at + 1 } })}
              >
                Next
              </button>
            )}
            <button type="button" className="back" onClick={() => setTip(null)}>Close</button>
          </div>
        )}

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
          <div className="sd-acts">
            <button type="button" className="back" disabled={state.status === 'won'} onClick={ask}>Tip</button>
            <button
              type="button"
              className="back"
              disabled={state.history.length === 0}
              onClick={() => onChange(undo)}
            >
              Return
            </button>
          </div>
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
  tracker,
}: {
  game: SudokuState | null;
  onGame: (action: SetStateAction<SudokuState | null>) => void;
  ready?: boolean;
  online?: boolean;
  unplayable?: boolean;
  onBack: () => void;
  tracker?: Tracker;
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
        tracker={tracker}
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
