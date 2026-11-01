import { useState } from 'react';
import Home from './Home';
import { TileArt } from './mahjong/TileArt';

export type Screen = 'home' | 'mahjong' | 'sudoku';

// Stands in for the game screens, which arrive in Tasks 5 and 6.
function Soon({ name, face, onBack }: { name: string; face: string; onBack: () => void }) {
  return (
    <main className="shell">
      <button type="button" className="back" onClick={onBack}>Back to home</button>
      <div className="soon">
        <span className="tile" aria-hidden="true"><TileArt face={face} /></span>
        <h1>{name}</h1>
        <p>This game is still being built.</p>
      </div>
    </main>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const goHome = () => setScreen('home');

  if (screen === 'mahjong') return <Soon name="Mahjong" face="cat" onBack={goHome} />;
  if (screen === 'sudoku') return <Soon name="Sudoku" face="star" onBack={goHome} />;
  return <Home onOpen={setScreen} />;
}
