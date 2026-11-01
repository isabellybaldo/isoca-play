import { useState } from 'react';
import { goToLogin, logout, newGameProblem, newMahjong, OFFLINE_NOTE } from './api';
import ConfirmDialog from './ConfirmDialog';
import Home from './Home';
import { LAYOUTS, type Layout, type Level } from './mahjong/layouts';
import MahjongGame from './mahjong/MahjongGame';
import MahjongSetup from './mahjong/MahjongSetup';
import { hasMovesToLose, newGame, type MahjongState } from './mahjong/rules';
import ResumeButton from './ResumeButton';
import SaveMarker from './SaveMarker';
import SudokuGame from './sudoku/SudokuGame';
import { useOnline, useSavedGame, type MahjongSave } from './useSavedGame';

export type Screen = 'home' | 'mahjong' | 'sudoku';

function Mahjong({
  level,
  onLevel,
  game,
  onGame,
  ready,
  online,
  onHome,
}: {
  level: Level;
  onLevel: (level: Level) => void;
  game: MahjongSave | null;
  onGame: (update: MahjongSave | ((g: MahjongSave | null) => MahjongSave | null)) => void;
  ready: boolean;
  online: boolean;
  onHome: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [replacing, setReplacing] = useState<Layout | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState('');
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
      />
    );
  }

  const start = async (chosen: Layout) => {
    setStarting(true);
    setProblem('');
    try {
      const deal = await newMahjong(chosen.id);
      onGame({ layout: chosen.id, state: newGame(deal.tiles) });
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
        onStart={(chosen) => (game && hasMovesToLose(game.state) ? setReplacing(chosen) : void start(chosen))}
        onBack={onHome}
        inert={replacing !== null}
        disabled={!online || !ready || starting}
        note={online ? problem : OFFLINE_NOTE}
        resume={
          game &&
          layout && (
            <ResumeButton
              name={layout.name}
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
          line="This game's moves will be lost."
          keepLabel="Keep playing"
          confirmLabel="Start new game"
          onKeep={() => setReplacing(null)}
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

// One game of each kind lives here, kept with the server, so Back never loses it and
// any device opens where the last one stopped.
export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [mahjongLevel, setMahjongLevel] = useState<Level>('easy');
  const [logoutNote, setLogoutNote] = useState('');
  const mahjong = useSavedGame('mahjong');
  const sudoku = useSavedGame('sudoku');
  const online = useOnline();
  const goHome = () => setScreen('home');

  const logOut = async () => {
    if (!online) {
      setLogoutNote(LOGOUT_OFFLINE);
      return;
    }
    setLogoutNote('');
    // A save still on its way would otherwise arrive after the session has ended.
    await Promise.all([mahjong.flush(), sudoku.flush()]);
    try {
      await logout();
      goToLogin();
    } catch {
      setLogoutNote(navigator.onLine === false ? LOGOUT_OFFLINE : LOGOUT_FAILED);
    }
  };

  let shown;
  if (screen === 'mahjong') {
    shown = (
      <Mahjong
        level={mahjongLevel}
        onLevel={setMahjongLevel}
        game={mahjong.state}
        onGame={mahjong.setState}
        ready={mahjong.ready}
        online={online}
        onHome={goHome}
      />
    );
  } else if (screen === 'sudoku') {
    shown = (
      <SudokuGame
        game={sudoku.state}
        onGame={sudoku.setState}
        ready={sudoku.ready}
        online={online}
        onBack={goHome}
      />
    );
  } else {
    shown = <Home onOpen={setScreen} onLogOut={() => void logOut()} note={logoutNote} />;
  }

  const worst = [mahjong.saving, sudoku.saving];
  return (
    <>
      {shown}
      <SaveMarker
        saving={worst.includes('offline') ? 'offline' : worst.includes('retrying') ? 'retrying' : 'saved'}
        signedOut={mahjong.signedOut || sudoku.signedOut}
      />
    </>
  );
}
