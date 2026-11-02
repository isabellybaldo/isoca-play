import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { CardBack, CardFace, cardName, EmptyAnswerPile } from './CardArt';
import { dropPile, type PileBox } from './drag';
import { cardScale, cellWidth, columnPitches, SPRITE, TABLE_CHROME } from './layout';
import { move, sendUp, tapPile, type Pile, type SolitaireState } from './rules';
import { tipFor, type Tip } from './tips';
import './solitaire.css';

const DRAG_PX = 8; // moving this far makes a press a drag, for good
const DOUBLE_TAP_MS = 350;
const ROW_GAP = 6; // between the top row and the columns
const ANSWER_CELL = 3; // pile, face-up pile, a gap, then the answer piles
const LIFTED_Z = 100;

function measureViewport() {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.innerHeight,
  };
}

export function useViewport() {
  const [viewport, setViewport] = useState(measureViewport);
  useEffect(() => {
    const measure = () => setViewport(measureViewport());
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return viewport;
}

// A tip belongs to the position it was asked in, so any move or Return drops it.
export function useTip(state: SolitaireState | null): { tip: Tip | null; ask: () => void } {
  const [held, setHeld] = useState<{ tip: Tip; history: SolitaireState['history'] } | null>(null);
  return {
    tip: held && held.history === state?.history ? held.tip : null,
    ask: () => {
      if (state) setHeld({ tip: tipFor(state), history: state.history });
    },
  };
}

type Lift = {
  pile: Pile;
  card: number; // the head of the run
  n: number;
  head: { x: number; y: number }; // the head's centre on screen when the press began
};

// One press, from pointer down to up. `lift` is empty for a press on the pile.
type Press = { id: number; x: number; y: number; moved: boolean; lift: Lift | null };

const topOf = (s: SolitaireState, pile: Pile): number | undefined => {
  if (pile === 'w') return s.waste[s.waste.length - 1];
  if (pile[0] === 'f') return undefined; // a card on an answer pile has nowhere further to go
  const up = s.columns[Number(pile[1])].up;
  return up[up.length - 1];
};

function Art({ width, height, children }: { width: number; height: number; children?: ReactNode }) {
  return (
    <span className="sol-art" style={{ width, height }}>
      {children}
    </span>
  );
}

export default function SolitaireTable({
  state,
  onChange,
  tip = null,
}: {
  state: SolitaireState;
  onChange: (update: (s: SolitaireState) => SolitaireState) => void;
  tip?: Tip | null;
}) {
  const viewport = useViewport();
  const [drag, setDrag] = useState<{ pile: Pile; n: number; dx: number; dy: number } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const lastTap = useRef<{ pile: Pile; card: number; at: number } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('sol-screen');
    return () => root.classList.remove('sol-screen');
  }, []);

  // A press belongs to the position and the layout it began in. A layout effect, so no event
  // can arrive between the new position showing and the press ending.
  useLayoutEffect(() => {
    press.current = null;
    lastTap.current = null;
    setDrag(null);
  }, [state.history, state.deal, viewport.width, viewport.height]);

  const scale = cardScale(viewport.width, viewport.height);
  const width = SPRITE.width * scale;
  const height = SPRITE.height * scale;
  const cell = cellWidth(viewport.width, scale);
  const tableHeight = viewport.height - TABLE_CHROME;
  const columnTop = height + ROW_GAP;
  const columnRoom = tableHeight - columnTop;

  const place = (index: number, top: number): CSSProperties => ({ left: index * cell, top, width: cell, height });

  const begin = (event: PointerEvent, lift: Lift | null) => {
    event.stopPropagation(); // the table clears the last tap for a press on anything else
    if (event.button !== 0 || state.status !== 'playing') return;
    if (press.current && press.current.id !== event.pointerId) return; // a second finger
    press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, lift };
    // The table holds the pointer, not the card: the card may leave the page mid-press.
    tableRef.current?.setPointerCapture?.(event.pointerId);
  };

  const beginCard = (event: PointerEvent, pile: Pile, card: number, n: number, style: CSSProperties) => {
    const box = tableRef.current?.getBoundingClientRect();
    const head = {
      x: (box?.left ?? 0) + Number(style.left) + cell / 2,
      y: (box?.top ?? 0) + Number(style.top) + height / 2,
    };
    begin(event, { pile, card, n, head });
  };

  // Updates this pointer's press and returns it; null if the pointer has no press going.
  const follow = (event: PointerEvent): Press | null => {
    const current = press.current;
    if (!current || current.id !== event.pointerId) return null;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (Math.hypot(dx, dy) >= DRAG_PX) current.moved = true;
    if (current.moved && current.lift) setDrag({ pile: current.lift.pile, n: current.lift.n, dx, dy });
    return current;
  };

  const end = (id: number) => {
    if (press.current?.id !== id) return;
    press.current = null;
    lastTap.current = null;
    setDrag(null);
  };

  const release = (event: PointerEvent) => {
    const done = follow(event); // the release may be the first this pointer has moved
    if (!done) return;
    press.current = null;
    setDrag(null);
    if (done.moved) {
      lastTap.current = null;
      if (done.lift) land(done.lift, event.clientX - done.x, event.clientY - done.y);
    } else if (done.lift) {
      tapCard(done.lift);
    } else {
      lastTap.current = null;
      onChange(tapPile);
    }
  };

  const land = (lift: Lift, dx: number, dy: number) => {
    const to = dropPile(dropBoxes(), lift.head.x + dx, lift.head.y + dy);
    if (to) onChange((s) => move(s, lift.pile, to, lift.n));
  };

  const dropBoxes = (): PileBox[] => {
    const box = tableRef.current?.getBoundingClientRect();
    const left = box?.left ?? 0;
    const top = box?.top ?? 0;
    const across = (index: number) => ({ left: left + index * cell, right: left + (index + 1) * cell });
    return [
      ...[0, 1, 2, 3].map((suit) => ({
        pile: `f${suit}` as Pile,
        ...across(ANSWER_CELL + suit),
        top,
        bottom: top + height,
      })),
      ...state.columns.map((_, index) => ({
        pile: `c${index}` as Pile,
        ...across(index),
        top: top + columnTop,
        // To the bottom of the screen and past it: a head card gripped by its top edge has its
        // centre below the finger, and that centre may be off the screen.
        bottom: Infinity,
      })),
    ];
  };

  const tapCard = ({ pile, card }: Lift) => {
    const now = Date.now();
    const last = lastTap.current;
    if (!last || last.pile !== pile || last.card !== card || now - last.at > DOUBLE_TAP_MS) {
      lastTap.current = { pile, card, at: now };
      return;
    }
    // The next tap starts over, whatever this one did, so a third is never half of a new pair.
    lastTap.current = null;
    // Only the top card of a column or the face-up pile goes; topOf is undefined for the rest.
    onChange((s) => (topOf(s, pile) === card ? sendUp(s, pile) : s));
  };

  const inTip = (pile: Pile, index: number, length: number) =>
    tip?.kind === 'move' &&
    ((tip.from === pile && index >= length - tip.n) || (tip.to === pile && index === length - 1));

  const faceUp = (pile: Pile, card: number, index: number, length: number, style: CSSProperties) => {
    const n = length - index;
    const lifted = drag && drag.pile === pile && n <= drag.n;
    const classes = ['sol-card', lifted && 'sol-lifted', inTip(pile, index, length) && 'sol-tip'];
    return (
      <button
        key={`card-${card}`}
        type="button"
        aria-label={cardName(card)}
        className={classes.filter(Boolean).join(' ')}
        style={lifted ? { ...style, transform: `translate(${drag.dx}px, ${drag.dy}px)`, zIndex: LIFTED_Z + index } : style}
        onPointerDown={(event) => beginCard(event, pile, card, n, style)}
      >
        <Art width={width} height={height}>
          <CardFace card={card} />
        </Art>
      </button>
    );
  };

  // A card that shows only once the one above it is lifted. Not a thing to press.
  const beneath = (card: number | undefined, index: number) =>
    card !== undefined && (
      <div key={`under-${index}`} className="sol-slot" aria-hidden="true" style={place(index, 0)}>
        <Art width={width} height={height}>
          <CardFace card={card} />
        </Art>
      </div>
    );

  const slot = (pile: Pile, index: number, top: number, covered: boolean, art?: ReactNode) => (
    <div
      key={`slot-${pile}`}
      data-pile={pile}
      className={!covered && tip?.kind === 'move' && tip.to === pile ? 'sol-slot sol-tip' : 'sol-slot'}
      aria-hidden={covered || undefined}
      style={place(index, top)}
    >
      <Art width={width} height={height}>
        {art ?? <span className="sol-empty" />}
      </Art>
    </div>
  );

  return (
    <div
      ref={tableRef}
      className="sol-table"
      style={{ width: cell * 7, height: tableHeight }}
      onPointerDown={() => {
        lastTap.current = null;
      }}
      onPointerMove={follow}
      onPointerUp={release}
      onPointerCancel={(event) => end(event.pointerId)}
      onLostPointerCapture={(event) => end(event.pointerId)}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        data-pile="stock"
        aria-label={state.stock.length > 0 ? `Pile, ${state.stock.length} ${state.stock.length === 1 ? 'card' : 'cards'}` : 'Empty pile, tap to turn back'}
        className={tip?.kind === 'turn' ? 'sol-card sol-tip' : 'sol-card'}
        style={place(0, 0)}
        onPointerDown={(event) => begin(event, null)}
      >
        <Art width={width} height={height}>
          {state.stock.length > 0 ? <CardBack /> : <span className="sol-empty" />}
        </Art>
      </button>

      {slot('w', 1, 0, state.waste.length > 0)}
      {beneath(state.waste[state.waste.length - 2], 1)}
      {state.waste.length > 0 &&
        faceUp('w', state.waste[state.waste.length - 1], state.waste.length - 1, state.waste.length, place(1, 0))}

      {state.foundations.map((count, suit) => {
        const pile = `f${suit}` as Pile;
        const index = ANSWER_CELL + suit;
        return [
          slot(pile, index, 0, count > 0, <EmptyAnswerPile suit={suit} />),
          count > 1 && beneath(suit * 13 + count - 2, index),
          count > 0 && faceUp(pile, suit * 13 + count - 1, count - 1, count, place(index, 0)),
        ];
      })}

      {state.columns.map((column, c) => {
        const pile = `c${c}` as Pile;
        const pitch = columnPitches({ down: column.down.length, up: column.up.length }, scale, columnRoom);
        const upTop = columnTop + column.down.length * pitch.down;
        return [
          column.down.length + column.up.length === 0 && slot(pile, c, columnTop, false),
          // By position alone: nothing about a face-down card may reach the page.
          column.down.map((_, i) => (
            <button
              key={`down-${c}-${i}`}
              type="button"
              aria-label="Face-down card"
              className="sol-card sol-still"
              style={place(c, columnTop + i * pitch.down)}
            >
              <Art width={width} height={height}>
                <CardBack />
              </Art>
            </button>
          )),
          column.up.map((card, i) => faceUp(pile, card, i, column.up.length, place(c, upTop + i * pitch.up))),
        ];
      })}
    </div>
  );
}
