// Back to the game left in memory, named so it is clear which one that is.
export default function ResumeButton({
  name,
  moves,
  onResume,
}: {
  name: string;
  moves: number;
  onResume: () => void;
}) {
  return (
    <button type="button" className="back resume" onClick={onResume}>
      Resume {name}, {moves} {moves === 1 ? 'move' : 'moves'}
    </button>
  );
}
