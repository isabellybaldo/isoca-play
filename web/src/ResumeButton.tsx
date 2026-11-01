// Back to the held game, named so it is clear which one that is.
export default function ResumeButton({
  name,
  noSlots = false,
  moves,
  onResume,
}: {
  name: string;
  noSlots?: boolean;
  moves: number;
  onResume: () => void;
}) {
  return (
    <button type="button" className="back resume" onClick={onResume}>
      Resume {name}, {noSlots ? 'no slots, ' : ''}{moves} {moves === 1 ? 'move' : 'moves'}
    </button>
  );
}
