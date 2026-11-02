import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BIG, COURT, RANK, SMALL, CardBack, CardFace, EmptyAnswerPile, cardName } from './CardArt';

afterEach(cleanup);

describe('card art data', () => {
  it('has rank rows 5 wide, 7 for the 10', () => {
    for (const [rank, rows] of Object.entries(RANK)) {
      expect(rows).toHaveLength(7);
      for (const row of rows) expect(row).toHaveLength(rank === '10' ? 7 : 5);
    }
    for (const rows of Object.values(SMALL)) for (const row of rows) expect(row).toHaveLength(5);
  });

  it('has court rows 14 wide', () => {
    for (const rows of Object.values(COURT)) for (const row of rows) expect(row).toHaveLength(14);
    for (const rows of Object.values(BIG)) {
      for (const row of rows) expect(row).toHaveLength(rows[0].length);
    }
  });
});

describe('card components', () => {
  it('names every card distinctly', () => {
    const names = new Set<string>();
    for (let c = 0; c < 52; c++) {
      const { getByRole, unmount } = render(<CardFace card={c} />);
      names.add(getByRole('img').getAttribute('aria-label')!);
      unmount();
    }
    expect(names.size).toBe(52);
    expect(cardName(0)).toBe('ace of hearts');
    expect(cardName(2 * 13 + 6)).toBe('7 of clubs');
    expect(cardName(3 * 13 + 12)).toBe('king of spades');
  });

  it('draws the frog, bunny and cat on the courts', () => {
    const fills = (card: number) => {
      const { container, unmount } = render(<CardFace card={card} />);
      const out = [...container.querySelectorAll('rect')].map((r) => r.getAttribute('fill'));
      unmount();
      return out;
    };
    expect(fills(10)).toContain('#7fd14f'); // jack: frog green
    expect(fills(11)).toContain('#ff86b8'); // queen: bunny ears
    expect(fills(12)).toContain('#ff9f5a'); // king: cat orange
    expect(fills(5)).not.toContain('#ff9f5a');
  });

  it('renders the back and an empty pile', () => {
    const back = render(<CardBack />);
    expect(back.getByRole('img').getAttribute('aria-label')).toBe('face-down card');
    back.unmount();
    const slot = render(<EmptyAnswerPile suit={3} />);
    expect(slot.getByRole('img').getAttribute('aria-label')).toBe('empty spades pile');
  });
});
