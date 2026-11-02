import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cardName } from './CardArt';
import { cardScale, SPRITE, TABLE_CHROME } from './layout';
import { type Pile, type SolitaireState } from './rules';
import SolitaireTable, { useTip } from './SolitaireTable';
import type { Tip } from './tips';

const HEART = 0;
const DIAMOND = 1;
const CLUB = 2;
const SPADE = 3;
const card = (rank: number, suit: number) => suit * 13 + rank - 1;

function table(shape: Partial<SolitaireState>): SolitaireState {
  return {
    deal: Array.from({ length: 52 }, (_, i) => i),
    stock: [],
    waste: [],
    columns: Array.from({ length: 7 }, () => ({ down: [], up: [] })),
    foundations: [0, 0, 0, 0],
    history: [],
    status: 'playing',
    ...shape,
  };
}

function columns(...given: { down?: number[]; up?: number[] }[]): SolitaireState['columns'] {
  return Array.from({ length: 7 }, (_, i) => ({ down: given[i]?.down ?? [], up: given[i]?.up ?? [] }));
}

// Stands in for the game screen, which holds the state.
function play(start: SolitaireState) {
  let current = start;
  function Screen() {
    const [state, setState] = useState(start);
    current = state;
    const { tip, ask } = useTip(state);
    return (
      <>
        <button onClick={ask}>ask</button>
        <button onClick={() => setState((s) => ({ ...s, history: [...s.history, 'd'] }))}>a new state</button>
        <SolitaireTable state={state} tip={tip} onChange={setState} />
      </>
    );
  }
  render(<Screen />);
  return { state: () => current };
}

const named = (name: string) => screen.getByRole('button', { name });
const ofCard = (c: number) => named(cardName(c));
const tableEl = () => document.querySelector<HTMLElement>('.sol-table')!;
const pileEl = (pile: Pile) => document.querySelector<HTMLElement>(`[data-pile="${pile}"]`)!;

// Once a pointer is down the table holds it, so later events arrive at the table.
function tap(el: Element, x = 200, y = 200) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(tableEl(), { pointerId: 1, clientX: x, clientY: y });
}

const centre = (el: HTMLElement) => ({
  x: parseFloat(el.style.left) + parseFloat(el.style.width) / 2,
  y: parseFloat(el.style.top) + parseFloat(el.style.height) / 2,
});

// Starts a drag of `el` and carries its centre to the point. The grip is deliberately off-centre.
function lift(el: HTMLElement, to: { x: number; y: number }) {
  const from = centre(el);
  const grip = { x: from.x + 3, y: from.y - 5 };
  fireEvent.pointerDown(el, { pointerId: 1, clientX: grip.x, clientY: grip.y });
  const end = { clientX: grip.x + to.x - from.x, clientY: grip.y + to.y - from.y };
  fireEvent.pointerMove(tableEl(), { pointerId: 1, ...end });
  return end;
}

function drag(el: HTMLElement, to: { x: number; y: number }) {
  const end = lift(el, to);
  fireEvent.pointerUp(tableEl(), { pointerId: 1, ...end });
}

let now = 1_000_000;

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.innerWidth = 1024;
  window.innerHeight = 768;
});

describe('the pile', () => {
  test('a tap on the pile turns a card', () => {
    const game = play(table({ stock: [card(5, HEART), card(6, HEART)] }));
    tap(named('Pile, 2 cards'));
    expect(game.state().waste).toEqual([card(5, HEART)]);
    expect(game.state().history).toEqual(['d']);
    expect(named('Pile, 1 cards')).toBeTruthy();
  });

  test('a tap on the empty pile turns it back', () => {
    const game = play(table({ waste: [card(5, HEART), card(6, HEART)] }));
    tap(named('Empty pile, tap to turn back'));
    expect(game.state().stock).toEqual([card(5, HEART), card(6, HEART)]);
    expect(game.state().waste).toEqual([]);
  });

  test('two fast taps on the pile turn two cards, and neither sends anything', () => {
    const game = play(table({ stock: [card(1, HEART), card(1, SPADE)] }));
    tap(named('Pile, 2 cards'));
    tap(named('Pile, 1 cards'));
    expect(game.state().waste).toEqual([card(1, HEART), card(1, SPADE)]);
    expect(game.state().foundations).toEqual([0, 0, 0, 0]);
  });

  test('a press on the pile that slides away does not turn a card', () => {
    const start = table({ stock: [card(5, HEART)] });
    const game = play(start);
    fireEvent.pointerDown(named('Pile, 1 cards'), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(tableEl(), { pointerId: 1, clientX: 60, clientY: 10 });
    fireEvent.pointerUp(tableEl(), { pointerId: 1, clientX: 10, clientY: 10 });
    expect(game.state()).toBe(start);
  });
});

describe('double tap', () => {
  test('a double tap sends a card that can go up', () => {
    const game = play(table({ columns: columns({ up: [card(1, CLUB)] }) }));
    tap(ofCard(card(1, CLUB)));
    now += 200;
    tap(ofCard(card(1, CLUB)));
    expect(game.state().foundations).toEqual([0, 0, 1, 0]);
    expect(game.state().columns[0].up).toEqual([]);
  });

  test('a double tap sends the top face-up pile card', () => {
    const game = play(table({ waste: [card(9, CLUB), card(1, DIAMOND)] }));
    tap(ofCard(card(1, DIAMOND)));
    tap(ofCard(card(1, DIAMOND)));
    expect(game.state().foundations).toEqual([0, 1, 0, 0]);
    expect(game.state().waste).toEqual([card(9, CLUB)]);
  });

  test('a single tap changes nothing', () => {
    const start = table({ columns: columns({ up: [card(1, CLUB)] }) });
    const game = play(start);
    tap(ofCard(card(1, CLUB)));
    expect(game.state()).toBe(start);
  });

  test('a double tap on a card that cannot go changes nothing', () => {
    const start = table({ columns: columns({ up: [card(5, CLUB)] }) });
    const game = play(start);
    tap(ofCard(card(5, CLUB)));
    tap(ofCard(card(5, CLUB)));
    expect(game.state()).toBe(start);
  });

  test('a double tap on a buried card changes nothing', () => {
    // The two of hearts could go up if it were on top.
    const start = table({ columns: columns({ up: [card(2, HEART), card(1, CLUB)] }), foundations: [1, 0, 0, 0] });
    const game = play(start);
    tap(ofCard(card(2, HEART)));
    tap(ofCard(card(2, HEART)));
    expect(game.state()).toBe(start);
  });

  test('a double tap on an answer pile changes nothing', () => {
    const start = table({ foundations: [1, 0, 0, 0] });
    const game = play(start);
    tap(ofCard(card(1, HEART)));
    tap(ofCard(card(1, HEART)));
    expect(game.state()).toBe(start);
  });

  test('a double tap never moves a card to a column', () => {
    // The five could go on the six, but only a drag does that.
    const start = table({ columns: columns({ up: [card(5, HEART)] }, { up: [card(6, SPADE)] }) });
    const game = play(start);
    tap(ofCard(card(5, HEART)));
    tap(ofCard(card(5, HEART)));
    expect(game.state()).toBe(start);
  });

  test('a third fast tap does not send the card now on top', () => {
    const game = play(table({ columns: columns({ up: [card(2, HEART), card(1, HEART)] }) }));
    tap(ofCard(card(1, HEART)));
    tap(ofCard(card(1, HEART)));
    expect(game.state().foundations).toEqual([1, 0, 0, 0]);
    now += 50;
    tap(ofCard(card(2, HEART)));
    expect(game.state().foundations).toEqual([1, 0, 0, 0]);
  });

  test('two taps on different cards are not a double tap', () => {
    const start = table({ columns: columns({ up: [card(1, HEART)] }, { up: [card(1, CLUB)] }) });
    const game = play(start);
    tap(ofCard(card(1, HEART)));
    tap(ofCard(card(1, CLUB)));
    expect(game.state()).toBe(start);
  });

  test('a tap on a buried card then the top card of that column is not a double tap', () => {
    const start = table({ columns: columns({ up: [card(2, SPADE), card(1, HEART)] }) });
    const game = play(start);
    tap(ofCard(card(2, SPADE)));
    tap(ofCard(card(1, HEART)));
    expect(game.state()).toBe(start);
  });

  test('a third tap after a refused double tap starts over', () => {
    const onChange = vi.fn();
    render(<SolitaireTable state={table({ columns: columns({ up: [card(5, CLUB)] }) })} onChange={onChange} />);
    tap(ofCard(card(5, CLUB)));
    tap(ofCard(card(5, CLUB)));
    tap(ofCard(card(5, CLUB)));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('two slow taps are not a double tap', () => {
    const start = table({ columns: columns({ up: [card(1, HEART)] }) });
    const game = play(start);
    tap(ofCard(card(1, HEART)));
    now += 351;
    tap(ofCard(card(1, HEART)));
    expect(game.state()).toBe(start);
    // The second was still a first tap of its own.
    now += 350;
    tap(ofCard(card(1, HEART)));
    expect(game.state().foundations).toEqual([1, 0, 0, 0]);
  });

  test('a tap on an empty area between two taps breaks the double tap', () => {
    const start = table({ columns: columns({ up: [card(1, HEART)] }) });
    const game = play(start);
    tap(ofCard(card(1, HEART)));
    tap(tableEl());
    tap(ofCard(card(1, HEART)));
    expect(game.state()).toBe(start);
  });

  test('a new state between two taps breaks the double tap', () => {
    const game = play(table({ columns: columns({ up: [card(1, HEART)] }) }));
    tap(ofCard(card(1, HEART)));
    fireEvent.click(named('a new state'));
    tap(ofCard(card(1, HEART)));
    expect(game.state().foundations).toEqual([0, 0, 0, 0]);
  });

  test('a small wobble under the threshold counts as a tap, not a drag', () => {
    const game = play(table({ columns: columns({ up: [card(1, HEART)] }) }));
    for (let i = 0; i < 2; i++) {
      const el = ofCard(card(1, HEART));
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(tableEl(), { pointerId: 1, clientX: 104, clientY: 104 }); // 5.7 px
      expect(el.style.transform).toBe('');
      fireEvent.pointerUp(tableEl(), { pointerId: 1, clientX: 104, clientY: 104 });
    }
    expect(game.state().foundations).toEqual([1, 0, 0, 0]);
  });

  test('a press that goes past the threshold and comes back is not a tap', () => {
    const start = table({ columns: columns({ up: [card(1, HEART)] }) });
    const game = play(start);
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(ofCard(card(1, HEART)), { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(tableEl(), { pointerId: 1, clientX: 108, clientY: 100 });
      fireEvent.pointerUp(tableEl(), { pointerId: 1, clientX: 100, clientY: 100 });
    }
    expect(game.state()).toBe(start);
  });

  test('a release far away with no move in between is not a tap', () => {
    const start = table({ columns: columns({ up: [card(1, HEART)] }) });
    const game = play(start);
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(ofCard(card(1, HEART)), { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(tableEl(), { pointerId: 1, clientX: 100, clientY: 140 });
    }
    expect(game.state()).toBe(start);
  });
});

describe('drag', () => {
  const eight = card(8, SPADE);
  const seven = card(7, HEART);
  const six = card(6, CLUB);
  const nine = card(9, DIAMOND);

  test('a drag that lands moves the run', () => {
    const game = play(table({ columns: columns({ up: [seven] }, { up: [eight] }) }));
    drag(ofCard(seven), centre(ofCard(eight)));
    expect(game.state().columns[1].up).toEqual([eight, seven]);
    expect(game.state().columns[0].up).toEqual([]);
  });

  test("a drag from a run's middle brings the cards below it", () => {
    const game = play(table({ columns: columns({ up: [nine, eight, seven, six] }, { up: [card(9, HEART)] }) }));
    drag(ofCard(eight), centre(ofCard(card(9, HEART))));
    expect(game.state().columns[0].up).toEqual([nine]);
    expect(game.state().columns[1].up).toEqual([card(9, HEART), eight, seven, six]);
    expect(game.state().history).toEqual(['c0>c1:3']);
  });

  test('while dragging, the run follows and the rest stays', () => {
    play(table({ columns: columns({ up: [nine, eight, seven] }) }));
    const from = centre(ofCard(eight));
    lift(ofCard(eight), { x: from.x + 40, y: from.y + 30 });
    expect(ofCard(eight).style.transform).toBe('translate(40px, 30px)');
    expect(ofCard(seven).style.transform).toBe('translate(40px, 30px)');
    expect(ofCard(nine).style.transform).toBe('');
  });

  test('a drop below a column lands on it', () => {
    const game = play(table({ columns: columns({ up: [seven] }, { up: [eight] }) }));
    drag(ofCard(seven), { x: centre(ofCard(eight)).x, y: window.innerHeight - 2 });
    expect(game.state().columns[1].up).toEqual([eight, seven]);
  });

  test('a king lands on an empty column', () => {
    const king = card(13, HEART);
    const game = play(table({ columns: columns({ up: [king] }) }));
    drag(ofCard(king), centre(pileEl('c4')));
    expect(game.state().columns[4].up).toEqual([king]);
  });

  test('a released invalid drag changes nothing and the card snaps back', () => {
    const start = table({ columns: columns({ up: [seven] }, { up: [nine] }) });
    const game = play(start);
    drag(ofCard(seven), centre(ofCard(nine)));
    expect(game.state()).toBe(start);
    expect(ofCard(seven).style.transform).toBe('');
  });

  test('a drag released in a gap changes nothing', () => {
    const start = table({ columns: columns({ up: [card(1, HEART)] }) });
    const game = play(start);
    const answer = centre(pileEl('f0'));
    drag(ofCard(card(1, HEART)), { x: answer.x - parseFloat(pileEl('f0').style.width), y: answer.y });
    expect(game.state()).toBe(start);
  });

  test('a drag onto an answer pile lands', () => {
    const game = play(table({ waste: [card(1, SPADE)] }));
    drag(ofCard(card(1, SPADE)), centre(pileEl('f3')));
    expect(game.state().foundations).toEqual([0, 0, 0, 1]);
  });

  test('a drag of two cards onto an answer pile changes nothing', () => {
    const start = table({ columns: columns({ up: [card(2, SPADE), card(1, HEART)] }), foundations: [0, 0, 0, 1] });
    const game = play(start);
    drag(ofCard(card(2, SPADE)), centre(pileEl('f3')));
    expect(game.state()).toBe(start);
  });

  test('a drag from an answer pile back to a column lands', () => {
    const game = play(table({ foundations: [0, 0, 7, 0], columns: columns({ up: [card(8, HEART)] }) }));
    drag(ofCard(card(7, CLUB)), centre(ofCard(card(8, HEART))));
    expect(game.state().foundations).toEqual([0, 0, 6, 0]);
    expect(game.state().columns[0].up).toEqual([card(8, HEART), card(7, CLUB)]);
  });

  test('only the top card of an answer pile is there to drag', () => {
    play(table({ foundations: [3, 0, 0, 0] }));
    expect(screen.queryByRole('button', { name: cardName(card(2, HEART)) })).toBeNull();
    expect(ofCard(card(3, HEART))).toBeTruthy();
  });

  test('only the top face-up pile card is there to drag', () => {
    play(table({ waste: [card(3, HEART), card(9, CLUB)] }));
    expect(screen.queryByRole('button', { name: cardName(card(3, HEART)) })).toBeNull();
    expect(ofCard(card(9, CLUB))).toBeTruthy();
  });

  test('pointercancel snaps back and changes nothing', () => {
    const start = table({ columns: columns({ up: [seven] }, { up: [eight] }) });
    const game = play(start);
    const end = lift(ofCard(seven), centre(ofCard(eight)));
    fireEvent.pointerCancel(tableEl(), { pointerId: 1, ...end });
    expect(ofCard(seven).style.transform).toBe('');
    fireEvent.pointerUp(tableEl(), { pointerId: 1, ...end });
    expect(game.state()).toBe(start);
  });

  test('losing the pointer ends the drag', () => {
    const start = table({ columns: columns({ up: [seven] }, { up: [eight] }) });
    const game = play(start);
    const end = lift(ofCard(seven), centre(ofCard(eight)));
    fireEvent.lostPointerCapture(tableEl(), { pointerId: 1 });
    expect(ofCard(seven).style.transform).toBe('');
    fireEvent.pointerUp(tableEl(), { pointerId: 1, ...end });
    expect(game.state()).toBe(start);
  });

  test('a state change mid-drag ends the drag', () => {
    const start = table({ columns: columns({ up: [seven] }, { up: [eight] }) });
    const onChange = vi.fn();
    const { rerender } = render(<SolitaireTable state={start} onChange={onChange} />);
    const end = lift(ofCard(seven), centre(ofCard(eight)));
    expect(ofCard(seven).style.transform).not.toBe('');

    rerender(<SolitaireTable state={{ ...start, history: ['d'] }} onChange={onChange} />);
    expect(ofCard(seven).style.transform).toBe('');
    fireEvent.pointerMove(tableEl(), { pointerId: 1, ...end });
    expect(ofCard(seven).style.transform).toBe('');
    fireEvent.pointerUp(tableEl(), { pointerId: 1, ...end });
    expect(onChange).not.toHaveBeenCalled();
  });

  test('a new deal mid-drag ends the drag even with the same history', () => {
    const start = table({ columns: columns({ up: [seven] }, { up: [eight] }) });
    const onChange = vi.fn();
    const { rerender } = render(<SolitaireTable state={start} onChange={onChange} />);
    const end = lift(ofCard(seven), centre(ofCard(eight)));
    rerender(<SolitaireTable state={{ ...start, deal: [...start.deal] }} onChange={onChange} />);
    fireEvent.pointerUp(tableEl(), { pointerId: 1, ...end });
    expect(onChange).not.toHaveBeenCalled();
  });

  test('a rerender that is not a new position keeps the drag', () => {
    const start = table({ columns: columns({ up: [seven] }, { up: [eight] }) });
    const onChange = vi.fn();
    const { rerender } = render(<SolitaireTable state={start} onChange={onChange} />);
    const end = lift(ofCard(seven), centre(ofCard(eight)));
    rerender(<SolitaireTable state={{ ...start }} onChange={onChange} />);
    fireEvent.pointerUp(tableEl(), { pointerId: 1, ...end });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('a landing is decided against the latest state', () => {
    const start = table({ columns: columns({ up: [seven] }, { up: [eight] }) });
    const onChange = vi.fn();
    render(<SolitaireTable state={start} onChange={onChange} />);
    drag(ofCard(seven), centre(ofCard(eight)));
    const update = onChange.mock.calls[0][0] as (s: SolitaireState) => SolitaireState;
    const latest = { ...start, status: 'won' as const };
    expect(update(latest)).toBe(latest);
  });

  test('a double tap is decided against the latest state', () => {
    const start = table({ columns: columns({ up: [card(1, HEART)] }) });
    const onChange = vi.fn();
    render(<SolitaireTable state={start} onChange={onChange} />);
    tap(ofCard(card(1, HEART)));
    tap(ofCard(card(1, HEART)));
    const update = onChange.mock.calls[0][0] as (s: SolitaireState) => SolitaireState;
    // Another card could go up, but it is not the card that was tapped.
    const latest = table({ columns: columns({ up: [card(1, CLUB)] }) });
    expect(update(latest)).toBe(latest);
  });

  test('a pointer that starts on a face-down card does nothing', () => {
    const start = table({ columns: columns({ down: [card(1, HEART)], up: [seven] }, { up: [eight] }) });
    const game = play(start);
    const back = named('Face-down card');
    tap(back);
    tap(back);
    drag(back, centre(ofCard(eight)));
    expect(back.style.transform).toBe('');
    expect(game.state()).toBe(start);
  });

  test('a pointer that starts on an empty area does nothing', () => {
    const start = table({ columns: columns({ up: [seven] }, { up: [eight] }) });
    const game = play(start);
    fireEvent.pointerDown(tableEl(), { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(tableEl(), { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(tableEl(), { pointerId: 1, clientX: 100, clientY: 100 });
    expect(game.state()).toBe(start);
  });

  test('a second finger does not disturb the drag', () => {
    const game = play(table({ columns: columns({ up: [seven] }, { up: [eight] }) }));
    const end = lift(ofCard(seven), centre(ofCard(eight)));
    fireEvent.pointerDown(ofCard(eight), { pointerId: 2, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(tableEl(), { pointerId: 2, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(tableEl(), { pointerId: 2, clientX: 300, clientY: 300 });
    expect(game.state().columns[1].up).toEqual([eight]);
    fireEvent.pointerUp(tableEl(), { pointerId: 1, ...end });
    expect(game.state().columns[1].up).toEqual([eight, seven]);
  });

  test('a mouse button other than the main one does nothing', () => {
    const start = table({ columns: columns({ up: [card(1, HEART)] }) });
    const game = play(start);
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(ofCard(card(1, HEART)), { pointerId: 1, button: 2, clientX: 9, clientY: 9 });
      fireEvent.pointerUp(tableEl(), { pointerId: 1, button: 2, clientX: 9, clientY: 9 });
    }
    expect(game.state()).toBe(start);
  });

  test('the table holds the pointer, so it survives the card going away', () => {
    const capture = vi.fn();
    const original = HTMLElement.prototype.setPointerCapture;
    HTMLElement.prototype.setPointerCapture = capture;
    try {
      play(table({ columns: columns({ up: [seven] }) }));
      fireEvent.pointerDown(ofCard(seven), { pointerId: 7, clientX: 1, clientY: 1 });
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.contexts[0]).toBe(tableEl());
      expect(capture).toHaveBeenCalledWith(7);
    } finally {
      HTMLElement.prototype.setPointerCapture = original;
    }
  });

  test('a table lower down the screen still lands where the card is', () => {
    const rect = { left: 30, top: 60, right: 0, bottom: 0, width: 0, height: 0, x: 30, y: 60, toJSON: () => ({}) };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    const game = play(table({ columns: columns({ up: [seven] }, { up: [eight] }) }));
    drag(ofCard(seven), centre(ofCard(eight)));
    expect(game.state().columns[1].up).toEqual([eight, seven]);
  });

  test('a long press opens no menu', () => {
    play(table({ columns: columns({ up: [seven] }) }));
    expect(fireEvent.contextMenu(ofCard(seven))).toBe(false);
  });

  test('a won game starts no drag', () => {
    const start = table({ status: 'won', foundations: [13, 13, 13, 13] });
    const game = play(start);
    const king = ofCard(card(13, HEART));
    lift(king, { x: 0, y: 500 });
    expect(king.style.transform).toBe('');
    expect(game.state()).toBe(start);
  });
});

describe('tips', () => {
  const highlighted = () =>
    [...document.querySelectorAll('.sol-tip')].map((el) => el.getAttribute('aria-label') ?? el.getAttribute('data-pile'));

  test('the tip highlights and a new state clears it', () => {
    const seven = card(7, HEART);
    const eight = card(8, SPADE);
    const start = table({ columns: columns({ down: [card(2, CLUB)], up: [seven] }, { up: [eight] }) });
    const game = play(start);
    expect(highlighted()).toEqual([]);
    fireEvent.click(named('ask'));
    expect(highlighted().sort()).toEqual([cardName(seven), cardName(eight)].sort());
    drag(ofCard(seven), centre(ofCard(eight)));
    expect(game.state().columns[1].up).toEqual([eight, seven]);
    expect(highlighted()).toEqual([]);
  });

  test('a tip changes nothing', () => {
    const start = table({ columns: columns({ down: [card(2, CLUB)], up: [card(7, HEART)] }, { up: [card(8, SPADE)] }) });
    const game = play(start);
    fireEvent.click(named('ask'));
    expect(game.state()).toBe(start);
  });

  test('a turn tip highlights the pile', () => {
    render(<SolitaireTable state={table({ stock: [card(5, CLUB)] })} tip={{ kind: 'turn', line: '' }} onChange={() => {}} />);
    expect(highlighted()).toEqual(['Pile, 1 cards']);
  });

  test('a none tip highlights nothing', () => {
    const state = table({ stock: [card(5, CLUB)], columns: columns({ up: [card(5, HEART)] }) });
    render(<SolitaireTable state={state} tip={{ kind: 'none', line: '' }} onChange={() => {}} />);
    expect(highlighted()).toEqual([]);
  });

  test('a move tip highlights the whole run and an empty target', () => {
    const tip: Tip = { kind: 'move', from: 'c0', to: 'c3', n: 2, line: '' };
    const state = table({ columns: columns({ up: [card(13, HEART), card(12, CLUB), card(11, HEART)] }) });
    render(<SolitaireTable state={state} tip={tip} onChange={() => {}} />);
    expect(highlighted().sort()).toEqual([cardName(card(12, CLUB)), cardName(card(11, HEART)), 'c3'].sort());
  });

  test('a move tip to an answer pile highlights its slot or top card', () => {
    const tip: Tip = { kind: 'move', from: 'w', to: 'f0', n: 1, line: '' };
    const { rerender } = render(<SolitaireTable state={table({ waste: [card(1, HEART)] })} tip={tip} onChange={() => {}} />);
    expect(highlighted().sort()).toEqual([cardName(card(1, HEART)), 'f0'].sort());
    const later = table({ waste: [card(2, HEART)], foundations: [1, 0, 0, 0] });
    rerender(<SolitaireTable state={later} tip={tip} onChange={() => {}} />);
    expect(highlighted().sort()).toEqual([cardName(card(2, HEART)), cardName(card(1, HEART))].sort());
  });
});

describe('what the table shows', () => {
  test('a face-down card has no identity in the page', () => {
    // Two positions the player cannot tell apart: only the hidden cards differ.
    const up = [card(7, HEART)];
    const a = table({ stock: [card(1, SPADE), card(2, SPADE)], columns: columns({ down: [card(3, SPADE), card(4, SPADE)], up }) });
    const b = table({ stock: [card(5, SPADE), card(6, SPADE)], columns: columns({ down: [card(9, SPADE), card(10, SPADE)], up }) });
    const first = render(<SolitaireTable state={a} onChange={() => {}} />);
    const page = first.container.innerHTML;
    first.unmount();
    const second = render(<SolitaireTable state={b} onChange={() => {}} />);
    expect(second.container.innerHTML).toBe(page);
    expect(page).not.toContain(cardName(card(3, SPADE)));
    expect(page).not.toContain(cardName(card(1, SPADE)));
    expect(screen.getAllByRole('button', { name: 'Face-down card' })).toHaveLength(2);
  });

  test('the identity stays hidden while dragging the card above it', () => {
    const hidden = card(3, SPADE);
    const state = table({ columns: columns({ down: [hidden], up: [card(7, HEART)] }) });
    const { container } = render(<SolitaireTable state={state} onChange={() => {}} />);
    lift(ofCard(card(7, HEART)), { x: 500, y: 500 });
    expect(container.innerHTML).not.toContain(cardName(hidden));
  });

  test('the pile draws one back, whatever its size', () => {
    render(<SolitaireTable state={table({ stock: [1, 2, 3, 4, 5] })} onChange={() => {}} />);
    expect(named('Pile, 5 cards')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Face-down card' })).toBeNull();
    expect(document.querySelectorAll('[data-pile="stock"] svg')).toHaveLength(1);
  });

  test('every face-up card is a button with its name', () => {
    const state = table({ columns: columns({ up: [card(13, SPADE), card(12, HEART)] }) });
    render(<SolitaireTable state={state} onChange={() => {}} />);
    expect(ofCard(card(13, SPADE)).tagName).toBe('BUTTON');
    expect(ofCard(card(12, HEART)).tagName).toBe('BUTTON');
  });

  test.each([
    [320, 568],
    [360, 640],
    [412, 915],
    [1280, 800],
    [1920, 1200],
  ])('cards are drawn at a whole-number scale at %i x %i', (width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    render(<SolitaireTable state={table({ waste: [card(7, HEART)] })} onChange={() => {}} />);
    const scale = cardScale(width, height);
    const art = ofCard(card(7, HEART)).querySelector<HTMLElement>('.sol-art')!;
    expect(art.style.width).toBe(`${SPRITE.width * scale}px`);
    expect(art.style.height).toBe(`${SPRITE.height * scale}px`);
  });

  test.each([
    [320, 568],
    [360, 640],
    [412, 915],
  ])('the worst column fits at %i x %i', (width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    const up = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((rank, i) => card(rank, i % 2 ? HEART : SPADE));
    render(<SolitaireTable state={table({ columns: columns({ down: [1, 2, 3, 4, 5, 6], up }) })} onChange={() => {}} />);
    const last = ofCard(up[12]);
    expect(parseFloat(last.style.top) + parseFloat(last.style.height)).toBeLessThanOrEqual(height - TABLE_CHROME);
    expect(parseFloat(tableEl().style.height)).toBe(height - TABLE_CHROME);
  });

  test('a new screen size is followed, and ends a drag', () => {
    const start = table({ columns: columns({ up: [card(7, HEART)] }) });
    render(<SolitaireTable state={start} onChange={() => {}} />);
    lift(ofCard(card(7, HEART)), { x: 400, y: 400 });
    window.innerWidth = 320;
    window.innerHeight = 568;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(ofCard(card(7, HEART)).style.transform).toBe('');
    expect(tableEl().style.height).toBe(`${568 - TABLE_CHROME}px`);
  });

  test('the page opts out of overscroll only while the table shows', () => {
    const { unmount } = render(<SolitaireTable state={table({})} onChange={() => {}} />);
    expect(document.documentElement.classList.contains('sol-screen')).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains('sol-screen')).toBe(false);
  });
});

describe('solitaire.css', () => {
  const css = readFileSync('src/solitaire/solitaire.css', 'utf8');

  test('the table and everything in it opts out of panning', () => {
    expect(css).toMatch(/\.sol-table,\s*\.sol-table \*\s*\{[^}]*touch-action:\s*none/);
  });

  test('nothing in the table can be selected', () => {
    expect(css).toMatch(/\.sol-table,\s*\.sol-table \*\s*\{[^}]*[^-]user-select:\s*none/);
  });

  test('the page has no overscroll while this screen shows', () => {
    expect(css).toMatch(/\.sol-screen[^{]*\{[^}]*overscroll-behavior:\s*none/);
  });

  test('a card button drops the floor every other button has', () => {
    expect(css).toMatch(/\.sol-card\s*\{[^}]*min-width:\s*0[^}]*min-height:\s*0/);
  });

  test('nothing comes from third parties', () => {
    expect(css).not.toMatch(/https?:\/\//);
  });
});
