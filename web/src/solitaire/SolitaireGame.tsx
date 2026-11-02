import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { newGameProblem, newSolitaire as askForDeal, REPLACE_UNPLAYABLE, startNote } from '../api';
import ConfirmDialog from '../ConfirmDialog';
import { tooShortSideways } from './layout';
import { hasMovesToLose, newSolitaire, undo, type SolitaireState } from './rules';
import SolitaireTable, { useTip, useViewport } from './SolitaireTable';
import './solitaire.css';

// No setup screen: this opens on the table, the saved game or a new deal. With neither, the
// line says why. The first deal needs no tap, and only a game on the table or a save that
// could not be read has anything to lose. It is the one save written with no tap, and this tab
// may have heard "no save" days ago, so the server is asked again first.
export default function SolitaireGame({
  game,
  onGame,
  ready,
  online,
  unplayable,
  check,
  onBack,
}: {
  game: SolitaireState | null;
  onGame: (update: SetStateAction<SolitaireState | null>) => void;
  ready: boolean;
  online: boolean;
  unplayable: boolean;
  check: () => Promise<boolean>;
  onBack: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState('');
  const { tip, ask } = useTip(game);
  const firstDeal = useRef(false);
  const viewport = useViewport();

  // A problem is about the game it happened to: once that has moved on, it is old news.
  useEffect(() => setProblem(''), [game?.history, game?.deal]);

  // The answer takes a while, and the game may have changed by then. With none on the table,
  // one that has arrived is kept. A tap that asked nothing, as there was nothing to lose,
  // does not take moves made since. A confirmed one does what the player said.
  const deal = async (confirmed = false) => {
    const onTable = game?.deal;
    setStarting(true);
    setProblem('');
    try {
      const next = newSolitaire((await askForDeal(onTable)).deal);
      onGame((held) => {
        if (!held) return next;
        if (!onTable) return held;
        return confirmed || !hasMovesToLose(held) ? next : held;
      });
    } catch (error) {
      setProblem(newGameProblem(error));
    } finally {
      setStarting(false);
    }
  };

  // Anything but a clear answer leaves the deal for later: the game it found is on its way up
  // to this screen, and a cached answer goes offline until coming back online asks again.
  const askThenDeal = async () => {
    setStarting(true);
    setProblem('');
    let clear = false;
    try {
      clear = await check();
    } catch (error) {
      setProblem(newGameProblem(error));
    }
    if (clear) {
      await deal();
    } else {
      firstDeal.current = false;
      setStarting(false);
    }
  };

  useEffect(() => {
    if (!ready || !online || game || unplayable || firstDeal.current) return;
    firstDeal.current = true;
    void askThenDeal();
  }, [ready, online, game, unplayable]);

  const won = game?.status === 'won';
  const note = startNote({ online, ready, starting, problem, unplayable });
  // What the player has just done comes first: a tip stays up until a move, so a New game
  // that fails has to be seen over it. Being offline is said only when there is nothing else.
  // A landscape phone can't scroll to the end of a long column, so it is told how to reach it.
  const turnPhone = game && tooShortSideways(viewport.width, viewport.height);
  const line =
    online && (starting || problem) ? note : tip ? tip.line : won ? 'You won.' : turnPhone ? 'Turn the phone upright.' : note;

  return (
    <>
      <main className="sol-game" inert={asking}>
        <div className="sol-bar">
          <button type="button" className="back" aria-label="Back to home" onClick={onBack}>Back</button>
          {game && (
            <>
              <button
                type="button"
                className="back"
                disabled={game.history.length === 0}
                onClick={() => onGame((g) => g && undo(g))}
              >
                Return
              </button>
              <button
                type="button"
                className="back"
                disabled={won}
                onClick={() => {
                  setProblem('');
                  ask();
                }}
              >
                Tip
              </button>
            </>
          )}
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
            void deal(true);
          }}
        />
      )}
    </>
  );
}
