import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { newGameProblem, newSolitaire as askForDeal, REPLACE_UNPLAYABLE, startNote } from '../api';
import ConfirmDialog from '../ConfirmDialog';
import { hasMovesToLose, newSolitaire, undo, type SolitaireState } from './rules';
import SolitaireTable, { useTip } from './SolitaireTable';
import './solitaire.css';

// No setup screen: this opens on the table, the saved game or a new deal. With neither, the
// line says why. The first deal needs no tap, and only a game on the table or a save that
// could not be read has anything to lose.
export default function SolitaireGame({
  game,
  onGame,
  ready,
  online,
  unplayable,
  onBack,
}: {
  game: SolitaireState | null;
  onGame: (update: SetStateAction<SolitaireState | null>) => void;
  ready: boolean;
  online: boolean;
  unplayable: boolean;
  onBack: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState('');
  const { tip, ask } = useTip(game);
  const firstDeal = useRef(false);

  // With no game on the table, one that arrives from another device meanwhile is kept.
  const deal = async () => {
    const onTable = game?.deal;
    setStarting(true);
    setProblem('');
    try {
      const next = newSolitaire((await askForDeal(onTable)).deal);
      onGame(onTable ? () => next : (held) => held ?? next);
    } catch (error) {
      setProblem(newGameProblem(error));
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (!ready || !online || game || unplayable || firstDeal.current) return;
    firstDeal.current = true;
    void deal();
  }, [ready, online, game, unplayable]);

  const won = game?.status === 'won';
  const note = startNote({ online, ready, starting, problem, unplayable });
  // What the player has just done comes first: a tip stays up until a move, so a New game
  // that fails has to be seen over it. Being offline is said only when there is nothing else.
  const line = online && (starting || problem) ? note : tip ? tip.line : won ? 'You won.' : note;

  return (
    <>
      <main className="sol-game" inert={asking}>
        <div className="sol-bar">
          <button type="button" className="back" aria-label="Back to home" onClick={onBack}>Back</button>
          <button
            type="button"
            className="back"
            disabled={!game || game.history.length === 0}
            onClick={() => onGame((g) => g && undo(g))}
          >
            Return
          </button>
          <button
            type="button"
            className="back"
            disabled={!game || won}
            onClick={() => {
              setProblem('');
              ask();
            }}
          >
            Tip
          </button>
          {(game || online) && (
            <button
              type="button"
              className="back"
              disabled={!online || !ready || starting}
              onClick={() => {
                if (unplayable || (game && hasMovesToLose(game))) setAsking(true);
                else void deal();
              }}
            >
              New game
            </button>
          )}
        </div>

        <div role="status" className="sol-line">
          {line}
        </div>

        {game && <SolitaireTable state={game} onChange={(update) => onGame((g) => g && update(g))} tip={tip} />}
      </main>

      {asking && (
        <ConfirmDialog
          title="Start a new game?"
          line={game ? 'This game will be lost.' : REPLACE_UNPLAYABLE}
          keepLabel={game ? 'Keep playing' : 'Not now'}
          confirmLabel="Start new game"
          onKeep={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void deal();
          }}
        />
      )}
    </>
  );
}
