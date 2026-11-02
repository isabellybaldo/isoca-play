import { useEffect, useState, type MouseEvent } from 'react';
import { newGameProblem, newMahjong, startNote } from '../api';
import ConfirmDialog from '../ConfirmDialog';
import { boardBox, tileHeight, tilePosition, tileWidth } from './boardSize';
import type { Layout } from './layouts';
import {
  hasMovesToLose,
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
import { faceName, TileArt, TileBack } from './TileArt';
import { useOnScreen, type Tracker } from '../stats/useTracked';
import { mahjongTip, type MahjongTip } from './tips';
import './mahjong.css';

function measureViewport(): { width: number; height: number } {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.innerHeight,
  };
}

// A button does its own job and is not a tap away from the selected tile.
const own = (action: () => void) => (event: MouseEvent) => {
  event.stopPropagation();
  action();
};

function BoardTile({
  state,
  tile,
  left,
  top,
  width,
  tipped,
  onTap,
}: {
  state: MahjongState;
  tile: Tile;
  left: number;
  top: number;
  width: number;
  tipped: boolean;
  onTap: (id: number) => void;
}) {
  const style = { left, top, width, height: tileHeight(width) };
  const click = own(() => onTap(tile.id));

  // The face stays out of the page until nothing lies on the tile.
  if (isCovered(state, tile.id)) {
    return (
      <button
        type="button"
        className="tile back-face"
        style={style}
        aria-label="Face-down tile"
        aria-disabled="true"
        onClick={click}
      >
        <TileBack />
      </button>
    );
  }

  const name = `${faceName(tile.face)} tile`;
  const free = isFree(state, tile.id);
  if (!free) {
    return (
      <button
        type="button"
        className="tile is-blocked"
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
  const classes = ['tile', selected && 'is-selected', tipped && 'is-tip'].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={classes}
      style={style}
      aria-label={tipped ? `${name}, tip` : name}
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
      <span className="tile" aria-hidden="true"><TileArt face={won ? 'heart' : 'star1'} /></span>
      <p className="mj-end-title">{won ? 'You won' : 'You lost'}</p>
      <p className="mj-end-line">
        {won
          ? `Board cleared in ${state.history.length} moves.`
          : state.noSlots
            ? 'No open pair left. Return takes the last move back.'
            : 'All 4 slots filled with no pair. Return takes the last move back.'}
      </p>
    </div>
  );
}

export default function MahjongGame({
  layout,
  state,
  onChange,
  online = true,
  onBack,
  tracker,
}: {
  layout: Layout;
  state: MahjongState;
  onChange: (update: (s: MahjongState) => MahjongState) => void;
  online?: boolean;
  onBack: () => void;
  tracker?: Tracker;
}) {
  useOnScreen(tracker);
  const [viewport, setViewport] = useState(measureViewport);
  const [asking, setAsking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState('');
  // A tip holds the board it was worked out on and shows only while that board is unchanged.
  // A tap that only selects a tile keeps both arrays, so it leaves the tip up.
  const [tip, setTip] = useState<(MahjongTip & { onBoard: number[]; slots: number[] }) | null>(null);

  useEffect(() => {
    const measure = () => setViewport(measureViewport());
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const newDeal = async () => {
    setStarting(true);
    setProblem('');
    try {
      const deal = await newMahjong(layout.id);
      const next = newGame(deal.tiles, { noSlots: state.noSlots });
      onChange(() => next);
    } catch (error) {
      setProblem(newGameProblem(error));
    } finally {
      setStarting(false);
    }
  };
  const note = startNote({ online, starting, problem });
  const width = tileWidth(layout, viewport.width, viewport.height, { noSlots: state.noSlots });
  const box = boardBox(layout, width);
  // Lower layers first, and each row left to right, so upper tiles lie on top.
  const tiles = state.tiles
    .filter((t) => state.onBoard.includes(t.id))
    .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  const shown = tip && tip.onBoard === state.onBoard && tip.slots === state.slots ? tip : null;
  const held = state.slots.map((id) => state.tiles.find((t) => t.id === id)!);

  return (
    <>
      <div className="mj-screen" onClick={() => onChange(tapElsewhere)}>
        <main className="shell mj-game" inert={asking}>
          <div className="mj-bar">
            <button type="button" className="back" aria-label="Back to setup" onClick={own(onBack)}>Back</button>
            <span className="mj-moves">Moves: {state.history.length}</span>
          </div>

          {!state.noSlots && (
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
          )}

          <div
            className="mj-board"
            role="group"
            aria-label="Board"
            style={{ width: box.width, height: box.height }}
          >
            {tiles.map((tile) => (
              <BoardTile
                key={tile.id}
                state={state}
                tile={tile}
                width={width}
                tipped={shown?.tiles.includes(tile.id) ?? false}
                {...tilePosition(tile, layout, width)}
                onTap={(id) => onChange((s) => tap(s, id))}
              />
            ))}
            <div role="status"><EndNote state={state} /></div>
          </div>

          <div aria-live="polite" className={shown ? 'mj-tip' : 'mj-tip is-empty'}>{shown?.line}</div>
          {shown && (
            <div className="mj-tipbtns">
              <button type="button" className="back" onClick={own(() => setTip(null))}>Close</button>
            </div>
          )}

          <div className="mj-actions">
            <button
              type="button"
              className="back"
              disabled={state.history.length === 0}
              onClick={own(() => onChange(undo))}
            >
              Return
            </button>
            <button
              type="button"
              className="back"
              disabled={state.status !== 'playing'}
              onClick={own(() => {
                tracker?.tip();
                setTip({ ...mahjongTip(state), onBoard: state.onBoard, slots: state.slots });
              })}
            >
              Tip
            </button>
            <button
              type="button"
              className="back"
              disabled={!online || starting}
              onClick={own(() => {
                if (hasMovesToLose(state)) setAsking(true);
                else void newDeal();
              })}
            >
              New game
            </button>
          </div>
          {note && <p className="start-note" aria-live="polite">{note}</p>}
        </main>
      </div>

      {asking && (
        <ConfirmDialog
          title="Start a new game?"
          line="This game's moves will be lost."
          keepLabel="Keep playing"
          confirmLabel="Start new game"
          onKeep={() => setAsking(false)}
          onConfirm={() => {
            void newDeal();
            setAsking(false);
          }}
        />
      )}
    </>
  );
}
