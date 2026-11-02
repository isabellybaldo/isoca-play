import { useEffect, useState } from 'react';
import {
  forgetLogoutUnconfirmed,
  goToLogin,
  logout,
  logoutUnconfirmed,
  markLogoutUnconfirmed,
  newGameProblem,
  newMahjong,
  REPLACE_UNPLAYABLE,
  startNote,
  takeLoggedInMark,
} from './api';
import ConfirmDialog from './ConfirmDialog';
import GameBoundary from './GameBoundary';
import Home from './Home';
import { LAYOUTS, type Layout, type Level } from './mahjong/layouts';
import MahjongGame from './mahjong/MahjongGame';
import MahjongSetup from './mahjong/MahjongSetup';
import { hasMovesToLose, newGame, type MahjongState } from './mahjong/rules';
import { clearDevice } from './offline';
import ResumeButton from './ResumeButton';
import { useSlotsSetting } from './mahjong/slotsSetting';
import SaveMarker from './SaveMarker';
import { sendRecords } from './stats/outbox';
import { useTracked, type Tracker } from './stats/useTracked';
import SolitaireGame from './solitaire/SolitaireGame';
import SudokuGame from './sudoku/SudokuGame';
import { useOnline, useSavedGame, type MahjongSave } from './useSavedGame';

export type Screen = 'home' | 'mahjong' | 'solitaire' | 'sudoku';

function Mahjong({
  level,
  onLevel,
  game,
  onGame,
  ready,
  online,
  unplayable,
  onHome,
  tracker,
}: {
  level: Level;
  onLevel: (level: Level) => void;
  game: MahjongSave | null;
  onGame: (update: MahjongSave | ((g: MahjongSave | null) => MahjongSave | null)) => void;
  ready: boolean;
  online: boolean;
  unplayable: boolean;
  onHome: () => void;
  tracker: Tracker;
}) {
  const [playing, setPlaying] = useState(false);
  const [replacing, setReplacing] = useState<Layout | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState('');
  const [slots, setSlots] = useSlotsSetting();
  const layout = game && LAYOUTS.find((l) => l.id === game.layout)!;

  if (playing && game && layout) {
    return (
      <MahjongGame
        layout={layout}
        state={game.state}
        onChange={(update: (s: MahjongState) => MahjongState) =>
          onGame((g) => {
            if (!g) return g;
            const state = update(g.state);
            return state === g.state ? g : { ...g, state };
          })
        }
        online={online}
        onBack={() => setPlaying(false)}
        tracker={tracker}
      />
    );
  }

  const start = async (chosen: Layout) => {
    setStarting(true);
    setProblem('');
    try {
      const deal = await newMahjong(chosen.id);
      onGame({ layout: chosen.id, state: newGame(deal.tiles, slots ? undefined : { noSlots: true }) });
      setPlaying(true);
    } catch (error) {
      setProblem(newGameProblem(error));
    } finally {
      setStarting(false);
    }
  };
  return (
    <>
      <MahjongSetup
        level={level}
        onLevel={onLevel}
        onStart={(chosen) =>
          unplayable || (game && hasMovesToLose(game.state)) ? setReplacing(chosen) : void start(chosen)
        }
        onBack={onHome}
        inert={replacing !== null}
        disabled={!online || !ready || starting}
        note={startNote({ online, ready, starting, problem, unplayable })}
        slots={slots}
        onSlots={setSlots}
        resume={
          game &&
          layout && (
            <ResumeButton
              name={layout.name}
              noSlots={game.state.noSlots}
              moves={game.state.history.length}
              onResume={() => {
                onLevel(layout.level);
                setPlaying(true);
              }}
            />
          )
        }
      />
      {replacing && (
        <ConfirmDialog
          title="Start a new game?"
          line={unplayable ? REPLACE_UNPLAYABLE : "This game's moves will be lost."}
          keepLabel="Keep playing"
          confirmLabel="Start new game"
          onKeep={() => {
            setReplacing(null);
            if (game && layout) {
              onLevel(layout.level);
              setPlaying(true);
            }
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

const LOGOUT_OFFLINE = 'Logging out needs a connection.';
const LOGOUT_FAILED = 'That did not work. Try again.';
const LOGOUT_UNCONFIRMED = 'Log out could not be confirmed, you are still signed in.';
const LOGOUT_PATIENCE = 3000;
const STATS_PATIENCE = 1000; // stats are not worth holding up a log out

// One game of each kind lives here, kept with the server, so Back never loses it and
// any device opens where the last one stopped.
export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [mahjongLevel, setMahjongLevel] = useState<Level>('easy');
  const [logoutNote, setLogoutNote] = useState('');
  const [askingLogout, setAskingLogout] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const mahjong = useSavedGame('mahjong');
  const solitaire = useSavedGame('solitaire');
  const sudoku = useSavedGame('sudoku');
  const trackedMahjong = useTracked('mahjong', mahjong);
  const trackedSolitaire = useTracked('solitaire', solitaire);
  const trackedSudoku = useTracked('sudoku', sudoku);
  const online = useOnline();
  const goHome = () => setScreen('home');
  const sessionGone = mahjong.signedOut || solitaire.signedOut || sudoku.signedOut;
  const sessionAlive = mahjong.signedIn || solitaire.signedIn || sudoku.signedIn;

  useEffect(takeLoggedInMark, []);

  // Finished games waiting on this device, from an earlier load or from being offline.
  useEffect(() => {
    const send = () => void sendRecords();
    send();
    window.addEventListener('online', send);
    return () => window.removeEventListener('online', send);
  }, []);

  // A log out left unconfirmed, on a boot that came back to the app. Said only once the
  // server has answered: a page from the worker's cache knows nothing about the session.
  useEffect(() => {
    if (!logoutUnconfirmed() || (!sessionGone && !sessionAlive)) return;
    forgetLogoutUnconfirmed();
    if (!sessionGone) setLogoutNote(LOGOUT_UNCONFIRMED);
  }, [sessionGone, sessionAlive]);

  const logOut = async () => {
    setLeaving(true);
    // A save still on its way would otherwise arrive after the session has ended.
    setLogoutNote('Saving your last moves.');
    const sent = await Promise.all([mahjong.flush(), solitaire.flush(), sudoku.flush()]);
    await Promise.race([sendRecords(), new Promise((resolve) => setTimeout(resolve, STATS_PATIENCE))]);
    setLogoutNote('');
    if (sent.every(Boolean)) await endSession();
    else {
      setLeaving(false);
      setAskingLogout(true);
    }
  };

  // A quick refusal or a dead link leaves the device as it is: the session can't be ended
  // offline, so the game stays until it can. Past the patience the device is cleared
  // without waiting: the server may well have ended the session with its answer held up.
  // From there any outcome goes to /login, which shows where the session really stands: a
  // live session goes straight back to the app, and the mark tells it this log out failed.
  // The mark goes on at the patience, not at the failure: a page can leave before that.
  const endSession = async () => {
    setLeaving(true);
    setLogoutNote('Logging out.');
    let clearing: Promise<unknown> | undefined;
    const clear = () => {
      const patience = new Promise((resolve) => setTimeout(resolve, LOGOUT_PATIENCE));
      clearing ??= Promise.race([clearDevice(), patience]);
      return clearing;
    };
    const slow = setTimeout(() => {
      markLogoutUnconfirmed();
      void clear();
    }, LOGOUT_PATIENCE);
    try {
      await logout();
      forgetLogoutUnconfirmed();
    } catch {
      if (!clearing) {
        clearTimeout(slow);
        setLogoutNote(LOGOUT_FAILED);
        setLeaving(false);
        return;
      }
    }
    clearTimeout(slow);
    await clear();
    goToLogin();
  };

  let shown;
  if (screen === 'mahjong') {
    shown = (
      <GameBoundary name="Mahjong" onNewGame={trackedMahjong.giveUp} onHome={goHome}>
      <Mahjong
        level={mahjongLevel}
        onLevel={setMahjongLevel}
        game={mahjong.state}
        onGame={trackedMahjong.onGame}
        tracker={trackedMahjong.tracker}
        ready={mahjong.ready}
        online={online}
        unplayable={mahjong.unplayable}
        onHome={goHome}
      />
      </GameBoundary>
    );
  } else if (screen === 'solitaire') {
    shown = (
      <GameBoundary name="Solitaire" onNewGame={trackedSolitaire.giveUp} onHome={goHome}>
      <SolitaireGame
        game={solitaire.state}
        onGame={trackedSolitaire.onGame}
        tracker={trackedSolitaire.tracker}
        ready={solitaire.ready}
        // A load answered from the device knows nothing of the server's game, and a deal now
        // would be saved over it. No new deal until the server itself has answered.
        online={online && solitaire.saving !== 'offline'}
        unplayable={solitaire.unplayable}
        check={solitaire.check}
        onBack={goHome}
      />
      </GameBoundary>
    );
  } else if (screen === 'sudoku') {
    shown = (
      <GameBoundary name="Sudoku" onNewGame={trackedSudoku.giveUp} onHome={goHome}>
      <SudokuGame
        game={sudoku.state}
        onGame={trackedSudoku.onGame}
        tracker={trackedSudoku.tracker}
        ready={sudoku.ready}
        online={online}
        unplayable={sudoku.unplayable}
        onBack={goHome}
      />
      </GameBoundary>
    );
  } else {
    shown = (
      <Home
        onOpen={setScreen}
        onLogOut={() => void logOut()}
        logOutDisabled={!online}
        leaving={leaving}
        note={online ? logoutNote : LOGOUT_OFFLINE}
        inert={askingLogout}
      />
    );
  }

  const worst = [mahjong.saving, solitaire.saving, sudoku.saving];
  return (
    <>
      {shown}
      <SaveMarker
        saving={!online || worst.includes('offline') ? 'offline' : worst.includes('retrying') ? 'retrying' : 'saved'}
        signedOut={online && sessionGone}
        refused={mahjong.refused || solitaire.refused || sudoku.refused}
        checking={mahjong.checking || solitaire.checking || sudoku.checking}
      />
      {askingLogout && (
        <ConfirmDialog
          title="Log out anyway?"
          line="Your last moves are not saved, and will be lost."
          keepLabel="Stay"
          confirmLabel="Log out"
          onKeep={() => setAskingLogout(false)}
          onConfirm={() => {
            setAskingLogout(false);
            void endSession();
          }}
        />
      )}
    </>
  );
}
