import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeDeal } from './deal';
import { LAYOUTS, layoutsFor, type Layout } from './layouts';
import MahjongGame, { dealGame } from './MahjongGame';
import MahjongSetup from './MahjongSetup';
import type { MahjongState, Tile } from './rules';

vi.mock('./deal', () => ({ makeDeal: vi.fn() }));

// Each level has one shape today; these tests also cover a level with several.
vi.mock('./layouts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./layouts')>();
  const extra: Layout = {
    id: 'spare',
    name: 'Spare',
    level: 'hard',
    cells: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
  };
  const all = [...real.LAYOUTS, extra];
  return { ...real, LAYOUTS: all, layoutsFor: (level: Layout['level']) => all.filter((l) => l.level === level) };
});

const layout: Layout = LAYOUTS[0];

function tile(id: number, face: string, x: number, y = 0, z = 0): Tile {
  return { id, x, y, z, face };
}

// Tiles two apart in x would touch, so four apart keeps every tile free.
const apart = (faces: string[]): Tile[] => faces.map((face, i) => tile(i, face, i * 4));

// The game itself lives above the screen; this stands in for App.
function play(tiles: Tile[]) {
  vi.mocked(makeDeal).mockReturnValue(tiles);
  const onBack = vi.fn();
  const held: { state?: MahjongState } = {};
  function Holder() {
    const [state, setState] = useState(() => dealGame(layout));
    held.state = state;
    return <MahjongGame layout={layout} state={state} onChange={setState} onBack={onBack} />;
  }
  const view = render(<Holder />);
  return { user: userEvent.setup(), onBack, held, ...view };
}

const tileButton = (name: string) => screen.getByRole('button', { name });
const slots = () => within(screen.getByRole('list', { name: 'Slots' })).getAllByRole('listitem');
const held = () =>
  slots().flatMap((slot) => within(slot).queryAllByRole('img').map((i) => i.getAttribute('aria-label')));

beforeEach(() => {
  vi.mocked(makeDeal).mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('setup', () => {
  function setup() {
    const onStart = vi.fn();
    const onBack = vi.fn();
    const onLevel = vi.fn();
    render(<MahjongSetup level="easy" onLevel={onLevel} onStart={onStart} onBack={onBack} />);
    return { user: userEvent.setup(), onStart, onBack, onLevel };
  }

  test('picking a level lists only its types, and random picks from that list', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    const onLevel = vi.fn();
    const { rerender } = render(
      <MahjongSetup level="hard" onLevel={onLevel} onStart={onStart} onBack={vi.fn()} />,
    );
    const hard = layoutsFor('hard');
    expect(hard.length).toBeGreaterThan(1);

    expect(screen.getByRole('button', { name: 'Hard' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Easy' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /^Fort/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Spare/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Frame/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Trophy/ })).toBeNull();

    const random = vi.spyOn(Math, 'random');
    random.mockReturnValue(0);
    await user.click(screen.getByRole('button', { name: 'Random' }));
    expect(onStart).toHaveBeenLastCalledWith(hard[0]);
    random.mockReturnValue(0.999);
    await user.click(screen.getByRole('button', { name: 'Random' }));
    expect(onStart).toHaveBeenLastCalledWith(hard[hard.length - 1]);

    await user.click(screen.getByRole('button', { name: 'Medium' }));
    expect(onLevel).toHaveBeenCalledWith('medium');
    rerender(<MahjongSetup level="medium" onLevel={onLevel} onStart={onStart} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Trophy/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Fort/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Random' }));
    expect(onStart).toHaveBeenLastCalledWith(layoutsFor('medium')[0]);
  });

  test.each([
    ['easy', 'Barely stacked.'],
    ['medium', 'Some stacking.'],
    ['hard', 'Taller stacks.'],
  ] as const)('the %s line says only how the shape stacks', (level, line) => {
    render(<MahjongSetup level={level} onLevel={vi.fn()} onStart={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.queryByText(/free/)).toBeNull();
  });

  test('the shape drawing shows every tile, upper layers over lower ones', () => {
    const { container } = render(
      <MahjongSetup level="hard" onLevel={vi.fn()} onStart={vi.fn()} onBack={vi.fn()} />,
    );
    const fort = layoutsFor('hard').find((l) => l.id === 'fort')!;
    const rects = [...container.querySelector('.mj-shape')!.querySelectorAll('rect')];
    expect(rects).toHaveLength(fort.cells.length);
    expect(rects[0].getAttribute('fill')).toBe('#4b3a5c');
    expect(rects[rects.length - 1].getAttribute('fill')).toBe('#ddfff7');
  });

  test('tapping a type starts it, and back goes home', async () => {
    const { user, onStart, onBack } = setup();
    await user.click(screen.getByRole('button', { name: /^Frame/ }));
    expect(onStart).toHaveBeenCalledWith(layoutsFor('easy')[0]);
    await user.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe('tile states', () => {
  test('a covered tile shows no face', async () => {
    const { user, container } = play([tile(0, 'moon', 0), tile(1, 'sun', 0, 0, 1)]);

    const covered = tileButton('Face-down tile');
    expect(covered.getAttribute('aria-disabled')).toBe('true');
    expect(covered.querySelector('svg')!.getAttribute('aria-label')).toBe('face-down tile');
    expect(container.innerHTML).not.toContain('moon');
    expect(screen.queryByRole('button', { name: /moon/i })).toBeNull();

    // Once the tile on top has gone, it is face up.
    await user.dblClick(tileButton('Sun tile'));
    expect(tileButton('Moon tile').getAttribute('aria-disabled')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Face-down tile' })).toBeNull();
  });

  test('a tile blocked at both sides is face up, dimmed and can not be selected', async () => {
    const { user } = play([tile(0, 'moon', 0), tile(1, 'star', 2), tile(2, 'sun', 4)]);
    const blocked = tileButton('Star tile, blocked');
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
    expect(blocked.classList.contains('is-blocked')).toBe(true);
    expect(blocked.querySelector('svg')!.getAttribute('aria-label')).toBe('star');
    expect(tileButton('Moon tile').classList.contains('is-blocked')).toBe(false);

    await user.click(blocked);
    expect(screen.queryByRole('button', { pressed: true })).toBeNull();
    await user.dblClick(blocked);
    expect(held()).toEqual([]);
  });

  test('tapping a blocked or covered tile leaves the selection alone', async () => {
    const { user } = play([
      tile(0, 'moon', 0), tile(1, 'star', 2), tile(2, 'sun', 4),
      tile(3, 'gem', 8), tile(4, 'leaf', 8, 0, 1),
    ]);
    await user.click(tileButton('Moon tile'));
    await user.click(tileButton('Star tile, blocked'));
    expect(tileButton('Moon tile').getAttribute('aria-pressed')).toBe('true');
    await user.click(tileButton('Face-down tile'));
    expect(tileButton('Moon tile').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the tile on the board', () => {
  test('a face-down tile is the same markup whatever its face', () => {
    const backOf = (face: string) => {
      const { unmount } = play([tile(0, face, 0), tile(1, 'frog', 1, 1, 1)]);
      const html = tileButton('Face-down tile').innerHTML;
      unmount();
      return html;
    };
    const cat = backOf('cat');
    expect(cat).toBe(backOf('spring'));
    expect(cat).not.toContain('cat');
  });

  test.each([
    [320, 568, 36, 46, 18, 20],
    [1366, 768, 54, 69, 27, 30],
  ])('at %i x %i a tile is whole-number scaled and half a unit is half a pitch', (w, h, tw, th, hx, hy) => {
    vi.stubGlobal('innerWidth', w);
    vi.stubGlobal('innerHeight', h);
    play([tile(0, 'moon', 4, 2), tile(1, 'sun', 5, 3, 1)]);
    const lower = tileButton('Face-down tile').style;
    const upper = tileButton('Sun tile').style;
    expect([upper.width, upper.height]).toEqual([`${tw}px`, `${th}px`]);
    expect(parseInt(upper.left) - parseInt(lower.left)).toBe(hx);
    expect(parseInt(upper.top) - parseInt(lower.top)).toBe(hy);
  });

  test('tiles are painted by layer, then row, then column', () => {
    play([tile(0, 'sun', 2, 2), tile(1, 'moon', 0, 2), tile(2, 'gem', 1, 1, 1), tile(3, 'cat', 6, 0)]);
    const order = within(screen.getByRole('group', { name: 'Board' }))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(order).toEqual(['Cat tile', 'Face-down tile', 'Face-down tile', 'Gem tile']);
  });
});

describe('the look in the stylesheet', () => {
  const css = readFileSync('src/mahjong/mahjong.css', 'utf8');
  const theme = readFileSync('src/theme.css', 'utf8');

  test('no layer step, shadow or square frame is left on a tile', () => {
    expect(css).not.toContain('is-raised');
    expect(theme).toMatch(/\.tile\s*\{[^}]*width:\s*36px;[^}]*height:\s*46px/);
    expect(theme).not.toMatch(/\.tile\s*\{[^}]*box-shadow/);
  });

  test('a slot holds one 36 x 46 tile, and the game is wide enough for 8 tiles at 54 px', () => {
    expect(css).toMatch(/\.mj-slot\s*\{[^}]*width:\s*44px;[^}]*height:\s*54px/);
    expect(css).toMatch(/\.shell\.mj-game\s*\{[^}]*max-width:\s*464px/);
  });

  test('the home heap uses a whole-number scale', () => {
    expect(theme).toMatch(/\.heap\s*\{[^}]*width:\s*54px;[^}]*height:\s*69px/);
  });
});

describe('the slot rule', () => {
  test('a season pairs with another season on screen, and return brings both back', async () => {
    const { user } = play(apart(['spring', 'winter', 'plum', 'rose']));
    await user.dblClick(tileButton('Spring tile'));
    expect(held()).toEqual(['spring']);
    await user.dblClick(tileButton('Plum tile'));
    expect(held()).toEqual(['spring', 'plum']);
    await user.dblClick(tileButton('Winter tile'));
    expect(held()).toEqual(['plum']);
    await user.click(screen.getByRole('button', { name: 'Return' }));
    expect(held()).toEqual(['spring', 'plum']);
    expect(tileButton('Winter tile')).toBeTruthy();
  });

  test('there are always four slot frames', async () => {
    const { user } = play(apart(['moon', 'sun']));
    expect(slots()).toHaveLength(4);
    await user.dblClick(tileButton('Moon tile'));
    expect(slots()).toHaveLength(4);
    expect(held()).toEqual(['moon']);
  });

  test('two taps send a tile to a slot; one tap only selects', async () => {
    const { user } = play(apart(['moon', 'sun']));

    await user.click(tileButton('Moon tile'));
    expect(tileButton('Moon tile').getAttribute('aria-pressed')).toBe('true');
    expect(tileButton('Moon tile').classList.contains('is-selected')).toBe(true);
    expect(held()).toEqual([]);

    await user.click(tileButton('Moon tile'));
    expect(held()).toEqual(['moon']);
    expect(screen.queryByRole('button', { name: 'Moon tile' })).toBeNull();
    expect(screen.getByText('Moves: 1')).toBeTruthy();
  });

  test('a fast double-tap counts as the two taps', async () => {
    const { user } = play(apart(['moon', 'sun']));
    await user.dblClick(tileButton('Sun tile'));
    expect(held()).toEqual(['sun']);
  });

  test('tapping another tile moves the selection', async () => {
    const { user } = play(apart(['moon', 'sun']));
    await user.click(tileButton('Moon tile'));
    await user.click(tileButton('Sun tile'));
    expect(tileButton('Moon tile').getAttribute('aria-pressed')).toBe('false');
    expect(tileButton('Sun tile').getAttribute('aria-pressed')).toBe('true');
    expect(held()).toEqual([]);
  });

  test('tapping the empty board clears the selection', async () => {
    const { user } = play(apart(['moon', 'sun']));
    await user.click(tileButton('Moon tile'));
    await user.click(screen.getByRole('group', { name: 'Board' }));
    expect(tileButton('Moon tile').getAttribute('aria-pressed')).toBe('false');
    await user.click(tileButton('Moon tile'));
    expect(held()).toEqual([]);
  });
});

describe('tapping away', () => {
  const isSelected = () => tileButton('Moon tile').getAttribute('aria-pressed') === 'true';

  test('the slots row clears the selection, and so do its tiles', async () => {
    const { user } = play(apart(['moon', 'sun', 'star']));
    await user.dblClick(tileButton('Star tile'));
    await user.click(tileButton('Moon tile'));
    await user.click(screen.getByRole('list', { name: 'Slots' }));
    expect(isSelected()).toBe(false);

    await user.click(tileButton('Moon tile'));
    await user.click(slots()[0].querySelector('.tile')!);
    expect(isSelected()).toBe(false);
  });

  test('the area below the buttons clears the selection', async () => {
    const { user, container } = play(apart(['moon', 'sun']));
    await user.click(tileButton('Moon tile'));
    await user.click(container.querySelector('.mj-screen')!);
    expect(isSelected()).toBe(false);
  });

  test('the bar and the row of buttons clear it, the buttons themselves do not', async () => {
    const { user, container } = play(apart(['moon', 'sun', 'star']));
    await user.dblClick(tileButton('Star tile'));
    await user.click(tileButton('Moon tile'));

    await user.click(screen.getByRole('button', { name: 'Back to setup' }));
    expect(isSelected()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'New game' }));
    await user.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(isSelected()).toBe(true);

    await user.click(container.querySelector('.mj-actions')!);
    expect(isSelected()).toBe(false);
  });

  test('the wrapper covers the whole screen, with a react handler and no document listener', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const { container } = play(apart(['moon', 'sun']));
    expect(container.querySelector('.mj-screen main')).not.toBeNull();
    expect(add.mock.calls.filter(([type]) => type === 'click')).toEqual([]);
    const css = readFileSync('src/mahjong/mahjong.css', 'utf8');
    expect(css).toMatch(/\.mj-screen\s*\{[^}]*min-height:\s*100dvh/);
  });
});

describe('the selected tile', () => {
  // Hit-testing needs a browser (see the report); this holds the rule in the stylesheet.
  const css = readFileSync('src/mahjong/mahjong.css', 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };

  test('keeps its box in place and in paint order', () => {
    const own = rule('.mj-board > .tile.is-selected');
    expect(own).not.toMatch(/transform|z-index|box-shadow:\s*0 0/);
  });

  test('shows the raised frame and face on layers that catch no taps', () => {
    const frame = rule('.mj-board > .tile.is-selected::before');
    expect(frame).toMatch(/pointer-events:\s*none/);
    expect(frame).toMatch(/transform: translate\(-1px, -2px\)/);
    expect(frame).toMatch(/0 0 0 5px #ffd166/);
    const face = rule('.mj-board > .tile.is-selected .pixels');
    expect(face).toMatch(/pointer-events:\s*none/);
    expect(face).toMatch(/transform: translate\(-1px, -2px\)/);
  });
});

describe('the end of a game', () => {
  test('a losing send shows lost, and return takes it back', async () => {
    const { user } = play(apart(['moon', 'sun', 'star', 'gem']));
    for (const name of ['Moon tile', 'Sun tile', 'Star tile']) await user.dblClick(tileButton(name));
    expect(screen.queryByText('You lost')).toBeNull();

    await user.dblClick(tileButton('Gem tile'));
    expect(screen.getByRole('status').textContent).toContain('You lost');
    expect(held()).toEqual(['moon', 'sun', 'star', 'gem']);

    await user.click(screen.getByRole('button', { name: 'Return' }));
    expect(screen.queryByText('You lost')).toBeNull();
    expect(held()).toEqual(['moon', 'sun', 'star']);
    expect(tileButton('Gem tile')).toBeTruthy();
    expect(screen.getByText('Moves: 3')).toBeTruthy();
  });

  test('clearing the board shows won', async () => {
    const { user } = play(apart(['moon', 'moon']));
    const [first] = screen.getAllByRole('button', { name: 'Moon tile' });
    await user.dblClick(first);
    expect(screen.queryByText('You won')).toBeNull();
    await user.dblClick(tileButton('Moon tile'));
    expect(screen.getByRole('status').textContent).toContain('You won');
    expect(held()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Return' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New game' })).toBeTruthy();
  });

  test('return is off until there is a move to take back', async () => {
    const { user } = play(apart(['moon', 'sun']));
    const back = () => screen.getByRole('button', { name: 'Return' }) as HTMLButtonElement;
    expect(back().disabled).toBe(true);
    await user.dblClick(tileButton('Moon tile'));
    expect(back().disabled).toBe(false);
    await user.click(back());
    expect(back().disabled).toBe(true);
  });
});

describe('leaving and starting over', () => {
  test('new game asks once in the page, and a confirming tap deals afresh', async () => {
    const confirm = vi.fn();
    const alert = vi.fn();
    vi.stubGlobal('confirm', confirm);
    vi.stubGlobal('alert', alert);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { user } = play(apart(['moon', 'sun']));
    await user.dblClick(tileButton('Moon tile'));

    vi.mocked(makeDeal).mockReturnValue(apart(['gem', 'leaf']));
    await user.click(screen.getByRole('button', { name: 'New game' }));
    const dialog = screen.getByRole('alertdialog');
    expect(held()).toEqual(['moon']); // nothing has changed yet

    await user.click(within(dialog).getByRole('button', { name: 'Start new game' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(held()).toEqual([]);
    expect(tileButton('Gem tile')).toBeTruthy();
    expect(screen.getByText('Moves: 0')).toBeTruthy();
    expect(makeDeal).toHaveBeenLastCalledWith(layout, 2147483648);
    expect(confirm).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  test('keep playing or Escape closes the question and changes nothing', async () => {
    const { user } = play(apart(['moon', 'sun']));
    await user.dblClick(tileButton('Moon tile'));
    const deals = vi.mocked(makeDeal).mock.calls.length;

    const newGame = screen.getByRole('button', { name: 'New game' });
    await user.click(newGame);
    const keep = screen.getByRole('button', { name: 'Keep playing' });
    expect(document.activeElement).toBe(keep);
    expect(newGame.closest('[inert]')).not.toBeNull();
    await user.click(keep);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(newGame.closest('[inert]')).toBeNull();
    expect(document.activeElement).toBe(newGame);

    await user.click(newGame);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();

    expect(held()).toEqual(['moon']);
    expect(vi.mocked(makeDeal).mock.calls.length).toBe(deals);
  });

  async function finish(user: ReturnType<typeof userEvent.setup>) {
    while (screen.getByRole('status').textContent === '') {
      await user.dblClick(screen.getAllByRole('button', { name: / tile$/ })[0]);
    }
  }

  test('new game does not ask once the game is won', async () => {
    const { user } = play(apart(['moon', 'moon']));
    await finish(user);
    vi.mocked(makeDeal).mockReturnValue(apart(['gem', 'leaf']));
    await user.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(tileButton('Leaf tile')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  test('new game asks on a lost game, which return could still save', async () => {
    const { user } = play(apart(['moon', 'sun', 'star', 'gem']));
    await finish(user);
    expect(screen.getByRole('status').textContent).toContain('You lost');
    await user.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.getByRole('status').textContent).toContain('You lost');

    vi.mocked(makeDeal).mockReturnValue(apart(['leaf', 'cat']));
    await user.click(screen.getByRole('button', { name: 'Start new game' }));
    expect(tileButton('Leaf tile')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  test('new game does not ask before the first move, or once every move is taken back', async () => {
    const { user } = play(apart(['moon', 'sun']));
    vi.mocked(makeDeal).mockReturnValue(apart(['gem', 'leaf']));
    await user.click(tileButton('Moon tile')); // only a selection, not a move
    await user.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(tileButton('Leaf tile')).toBeTruthy();

    await user.dblClick(tileButton('Leaf tile'));
    await user.click(screen.getByRole('button', { name: 'Return' }));
    await user.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('a new deal seed comes from Math.random, for the layout in play', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    play(apart(['moon', 'sun']));
    expect(makeDeal).toHaveBeenCalledWith(layout, 2 ** 30);
  });

  test('back leaves at once, with no question, and the game stays as it was', async () => {
    const { user, onBack, held } = play(apart(['moon', 'sun']));
    await user.dblClick(tileButton('Moon tile'));
    const before = held.state;
    await user.click(screen.getByRole('button', { name: 'Back to setup' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(held.state).toBe(before);
    expect(held.state!.slots).toHaveLength(1);
  });
});
