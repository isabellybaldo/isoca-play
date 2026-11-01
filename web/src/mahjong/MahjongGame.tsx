import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { boardBox, tilePosition, tileWidth } from './boardSize';
import { makeDeal } from './deal';
import type { Layout } from './layouts';
import {
  isCovered,
  isFree,
  newGame,
  SLOT_COUNT,
  tap,
  tapElsewhere,
  undo,
  type MahjongState,
  type Tile,
} from './rules';
import { TileArt, TileBack } from './TileArt';
import './mahjong.css';

// Wider screens get the board of a 440 px one, so its ten rows still fit a laptop.
const WIDEST_VIEWPORT = 440; // matches the max-width of .mj-game

function viewportWidth(): number {
  return Math.min(document.documentElement.clientWidth || window.innerWidth, WIDEST_VIEWPORT);
}

function deal(layout: Layout): MahjongState {
  return newGame(makeDeal(layout, Math.floor(Math.random() * 2 ** 32)));
}

function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function BoardTile({
  state,
  tile,
  left,
  top,
  width,
  onTap,
}: {
  state: MahjongState;
  tile: Tile;
  left: number;
  top: number;
  width: number;
  onTap: (id: number) => void;
}) {
  const style = { left, top, width, height: width };
  const base = tile.z > 0 ? 'tile is-raised' : 'tile';
  const click = (event: MouseEvent) => {
    event.stopPropagation(); // a tile is not the empty board
    onTap(tile.id);
  };

  // The face stays out of the page until nothing lies on the tile.
  if (isCovered(state, tile.id)) {
    return (
      <button
        type="button"
        className={`${base} back-face`}
        style={style}
        aria-label="Face-down tile"
        aria-disabled="true"
        onClick={click}
      >
        <TileBack />
      </button>
    );
  }

  const name = `${capitalised(tile.face)} tile`;
  const free = isFree(state, tile.id);
  if (!free) {
    return (
      <button
        type="button"
        className={`${base} is-blocked`}
        style={style}
        aria-label={`${name}, blocked`}
        aria-disabled="true"
        onClick={click}
      >
        <TileArt face={tile.face} />
      </button>
    );
  }

  const selected = state.selected === tile.id;
  return (
    <button
      type="button"
      className={selected ? `${base} is-selected` : base}
      style={style}
      aria-label={name}
      aria-pressed={selected}
      aria-disabled={state.status !== 'playing'}
      onClick={click}
    >
      <TileArt face={tile.face} />
    </button>
  );
}

function EndNote({ state }: { state: MahjongState }) {
  if (state.status === 'playing') return null;
  const won = state.status === 'won';
  return (
    <div className={won ? 'mj-end is-won' : 'mj-end is-lost'}>
      <span className="tile" aria-hidden="true"><TileArt face={won ? 'star' : 'ghost'} /></span>
      <p className="mj-end-title">{won ? 'You won' : 'You lost'}</p>
      <p className="mj-end-line">
        {won
          ? `Board cleared in ${state.history.length} moves.`
          : 'All 4 slots filled with no pair. Return takes the last move back.'}
      </p>
    </div>
  );
}

export default function MahjongGame({ layout, onBack }: { layout: Layout; onBack: () => void }) {
  const [state, setState] = useState(() => deal(layout));
  const [viewport, setViewport] = useState(viewportWidth);
  const [asking, setAsking] = useState(false);
  const newGameButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  useEffect(() => {
    const measure = () => setViewport(viewportWidth());
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Focus follows the question in and back out. This runs after commit, once
  // the game behind has stopped being inert and can take focus again.
  useEffect(() => {
    if (asking) keepButton.current?.focus();
    else if (wasAsking.current) newGameButton.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const width = tileWidth(layout, viewport);
  const box = boardBox(layout, width);
  // Lower layers first, and each row left to right, so upper tiles lie on top.
  const tiles = state.tiles
    .filter((t) => state.onBoard.includes(t.id))
    .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  const held = state.slots.map((id) => state.tiles.find((t) => t.id === id)!);

  return (
    <>
      <main className="shell mj-game" inert={asking}>
        <div className="mj-bar">
          <button type="button" className="back" aria-label="Back to setup" onClick={onBack}>Back</button>
          <span className="mj-moves">Moves: {state.history.length}</span>
        </div>

        <div className="mj-slots">
          <span className="mj-slots-name" id="mj-slots-name">Slots</span>
          <ol className="mj-slot-row" aria-labelledby="mj-slots-name">
            {Array.from({ length: SLOT_COUNT }, (_, i) => (
              <li key={i} className="mj-slot">
                {held[i] ? (
                  <span className="tile"><TileArt face={held[i].face} /></span>
                ) : (
                  <span className="mj-sr">Empty</span>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div
          className="mj-board"
          role="group"
          aria-label="Board"
          style={{ width: box.width, height: box.height }}
          onClick={() => setState((s) => tapElsewhere(s))}
        >
          {tiles.map((tile) => (
            <BoardTile
              key={tile.id}
              state={state}
              tile={tile}
              width={width}
              {...tilePosition(tile, layout, width)}
              onTap={(id) => setState((s) => tap(s, id))}
            />
          ))}
          <div role="status"><EndNote state={state} /></div>
        </div>

        <div className="mj-actions">
          <button
            type="button"
            className="back"
            disabled={state.history.length === 0}
            onClick={() => setState((s) => undo(s))}
          >
            Return
          </button>
          <button
            ref={newGameButton}
            type="button"
            className="back"
            onClick={() => {
              if (state.status === 'playing') setAsking(true);
              else setState(deal(layout));
            }}
          >
            New game
          </button>
        </div>
      </main>

      {asking && (
        <div
          className="mj-dialog-veil"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setAsking(false);
          }}
        >
          <div className="mj-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mj-ask" aria-describedby="mj-ask-line">
            <h2 id="mj-ask">Start a new game?</h2>
            <p id="mj-ask-line">This game's moves will be lost.</p>
            <div className="mj-dialog-actions">
              <button ref={keepButton} type="button" className="back" onClick={() => setAsking(false)}>
                Keep playing
              </button>
              <button
                type="button"
                className="back mj-confirm"
                onClick={() => {
                  setState(deal(layout));
                  setAsking(false);
                }}
              >
                Start new game
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
