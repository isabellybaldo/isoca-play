import type { ReactNode } from 'react';
import { layoutsFor, type Layout, type Level } from './layouts';
import './mahjong.css';

const LEVELS: { id: Level; name: string; line: string }[] = [
  { id: 'easy', name: 'Easy', line: 'Flat shapes, many tiles free.' },
  { id: 'medium', name: 'Medium', line: 'Some stacking.' },
  { id: 'hard', name: 'Hard', line: 'Tall, tight stacks, few tiles free.' },
];

// The shape seen from above: the higher the stack at a spot, the brighter it is.
const STACK_COLOURS = ['#4b3a5c', '#aa4465', '#ffa69e', '#ddfff7'];

function ShapeDrawing({ layout }: { layout: Layout }) {
  const tops = new Map<string, { x: number; y: number; z: number }>();
  for (const cell of layout.cells) {
    const key = `${cell.x},${cell.y}`;
    const seen = tops.get(key);
    if (!seen || cell.z > seen.z) tops.set(key, cell);
  }
  const width = Math.max(...layout.cells.map((c) => c.x)) + 2;
  const height = Math.max(...layout.cells.map((c) => c.y)) + 2;
  return (
    <svg className="mj-shape" viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges" aria-hidden="true">
      {[...tops.values()].map((c) => (
        <rect
          key={`${c.x},${c.y}`}
          x={c.x}
          y={c.y}
          width={1.75}
          height={1.75}
          fill={STACK_COLOURS[Math.min(c.z, STACK_COLOURS.length - 1)]}
        />
      ))}
    </svg>
  );
}

export default function MahjongSetup({
  level,
  onLevel,
  onStart,
  onBack,
  inert,
  resume,
}: {
  level: Level;
  onLevel: (level: Level) => void;
  onStart: (layout: Layout) => void;
  onBack: () => void;
  inert?: boolean;
  resume?: ReactNode;
}) {
  const types = layoutsFor(level);
  const current = LEVELS.find((l) => l.id === level)!;

  return (
    <main className="shell mj-setup" inert={inert}>
      <button type="button" className="back" onClick={onBack}>Back to home</button>
      <h1 className="mj-title">Mahjong</h1>
      {resume}

      <div className="mj-levels" role="group" aria-label="Difficulty">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            className="mj-level"
            aria-pressed={l.id === level}
            onClick={() => onLevel(l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>

      <div className="mj-types-head">
        <h2>{current.name} types</h2>
        <button
          type="button"
          className="back"
          onClick={() => onStart(types[Math.floor(Math.random() * types.length)])}
        >
          Random
        </button>
      </div>
      <p className="mj-line">{current.line}</p>

      <div className="mj-types">
        {types.map((layout) => (
          <button key={layout.id} type="button" className="mj-type" onClick={() => onStart(layout)}>
            <ShapeDrawing layout={layout} />
            <span className="mj-type-name">{layout.name}</span>
            <span className="mj-type-count">{layout.cells.length} tiles</span>
          </button>
        ))}
      </div>

      <p className="mj-line">Tap a type to start.</p>
    </main>
  );
}
