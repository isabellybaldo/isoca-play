import type { Screen } from './App';
import { TileArt, TileBack } from './mahjong/TileArt';

function MahjongArt() {
  return (
    <span className="game-art" aria-hidden="true">
      <span className="tile heap"><TileArt face="cat" /></span>
      <span className="tile heap"><TileArt face="cherry" /></span>
      <span className="tile heap back-face"><TileBack /></span>
      <span className="tile heap"><TileArt face="ghost" /></span>
    </span>
  );
}

function SudokuArt() {
  return (
    <span className="game-art" aria-hidden="true">
      <span className="mini">
        <span>5</span>
        <span className="quiet">3</span>
        <span>8</span>
        <span className="quiet">1</span>
        <span><TileArt face="star" /></span>
        <span>7</span>
        <span>6</span>
        <span>2</span>
        <span className="quiet">4</span>
      </span>
    </span>
  );
}

export default function Home({ onOpen }: { onOpen: (screen: Screen) => void }) {
  return (
    <main className="shell">
      <h1 className="home-title">isoca play</h1>
      <div className="games">
        <button type="button" className="game" onClick={() => onOpen('mahjong')}>
          <MahjongArt />
          <span className="game-name">Mahjong</span>
          <span className="game-line">Match the pairs and clear the board.</span>
        </button>
        <button type="button" className="game sudoku" onClick={() => onOpen('sudoku')}>
          <SudokuArt />
          <span className="game-name">Sudoku</span>
          <span className="game-line">Fill the grid, one to nine.</span>
        </button>
      </div>
    </main>
  );
}
