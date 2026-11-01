import { useState } from 'react';
import Home from './Home';
import type { Layout, Level } from './mahjong/layouts';
import MahjongGame from './mahjong/MahjongGame';
import MahjongSetup from './mahjong/MahjongSetup';
import SudokuGame from './sudoku/SudokuGame';

export type Screen = 'home' | 'mahjong' | 'sudoku';

// The level lives here so it is still picked on coming back from a game.
function Mahjong({ onHome }: { onHome: () => void }) {
  const [level, setLevel] = useState<Level>('easy');
  const [layout, setLayout] = useState<Layout | null>(null);
  if (layout) return <MahjongGame layout={layout} onBack={() => setLayout(null)} />;
  return <MahjongSetup level={level} onLevel={setLevel} onStart={setLayout} onBack={onHome} />;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const goHome = () => setScreen('home');

  if (screen === 'mahjong') return <Mahjong onHome={goHome} />;
  if (screen === 'sudoku') return <SudokuGame onBack={goHome} />;
  return <Home onOpen={setScreen} />;
}
