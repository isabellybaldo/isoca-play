import { useState, type Dispatch, type SetStateAction } from 'react';
import ConfirmDialog from './ConfirmDialog';
import Home from './Home';
import type { Layout, Level } from './mahjong/layouts';
import MahjongGame, { dealGame } from './mahjong/MahjongGame';
import MahjongSetup from './mahjong/MahjongSetup';
import { hasMovesToLose, type MahjongState } from './mahjong/rules';
import ResumeButton from './ResumeButton';
import type { SudokuState } from './sudoku/rules';
import SudokuGame from './sudoku/SudokuGame';

export type Screen = 'home' | 'mahjong' | 'sudoku';

type HeldMahjong = { layout: Layout; state: MahjongState };

function Mahjong({
  level,
  onLevel,
  game,
  onGame,
  onHome,
}: {
  level: Level;
  onLevel: (level: Level) => void;
  game: HeldMahjong | null;
  onGame: Dispatch<SetStateAction<HeldMahjong | null>>;
  onHome: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [replacing, setReplacing] = useState<Layout | null>(null);

  if (playing && game) {
    return (
      <MahjongGame
        layout={game.layout}
        state={game.state}
        onChange={(update) => onGame((g) => g && { ...g, state: update(g.state) })}
        onBack={() => setPlaying(false)}
      />
    );
  }

  const start = (layout: Layout) => {
    onGame({ layout, state: dealGame(layout) });
    setPlaying(true);
  };
  return (
    <>
      <MahjongSetup
        level={level}
        onLevel={onLevel}
        onStart={(layout) => (game && hasMovesToLose(game.state) ? setReplacing(layout) : start(layout))}
        onBack={onHome}
        inert={replacing !== null}
        resume={
          game && (
            <ResumeButton
              name={game.layout.name}
              moves={game.state.history.length}
              onResume={() => {
                onLevel(game.layout.level);
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
            start(replacing);
            setReplacing(null);
          }}
        />
      )}
    </>
  );
}

// One game of each kind lives here, in memory only, so Back never loses it.
export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [mahjongLevel, setMahjongLevel] = useState<Level>('easy');
  const [mahjong, setMahjong] = useState<HeldMahjong | null>(null);
  const [sudoku, setSudoku] = useState<SudokuState | null>(null);
  const goHome = () => setScreen('home');

  if (screen === 'mahjong') {
    return <Mahjong level={mahjongLevel} onLevel={setMahjongLevel} game={mahjong} onGame={setMahjong} onHome={goHome} />;
  }
  if (screen === 'sudoku') return <SudokuGame game={sudoku} onGame={setSudoku} onBack={goHome} />;
  return <Home onOpen={setScreen} />;
}
