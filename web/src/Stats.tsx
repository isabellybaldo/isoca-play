import { useCallback, useEffect, useState } from 'react';
import { loadStats, type GameTotals, type MapTotals, type StatsAnswer } from './api';
import { localDay } from './stats/useTracked';

const named = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const shown = (value: number | null, unit = '') => (value === null ? '–' : `${value}${unit}`);
const clock = (seconds: number | null) =>
  seconds === null ? '–' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function line(label: string, count: GameTotals | MapTotals | GameTotals['levels'][number]): string {
  const ended = 'lost' in count ? `, ${count.lost} lost, ${count.abandoned} abandoned` : '';
  return (
    `${label}: ${count.played} played, ${count.won} won (${shown(count.win_rate, '%')}), ` +
    `average win ${clock(count.avg_win_seconds)}, best ${clock(count.best_win_seconds)}${ended}`
  );
}

function Totals({ answer }: { answer: StatsAnswer }) {
  const { public: totals, private: mine } = answer;
  if (!totals) return <p className="stats-note">No games recorded yet.</p>;
  return (
    <>
      {totals.games.map((game) => (
        <section key={game.game}>
          <h2>{named(game.game)}</h2>
          <ul>
            <li>{line('All', game)}</li>
            <li>Average returns {shown(game.avg_returns)}, tips {shown(game.avg_tips)}</li>
            {game.levels.map((level) => (
              <li key={level.level}>{line(named(level.level), level)}</li>
            ))}
          </ul>
        </section>
      ))}
      {totals.maps.length > 0 && (
        <section>
          <h2>Mahjong maps</h2>
          <ul>
            {totals.maps.map((m) => (
              <li key={m.map}>{line(m.name, m)}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2>Streaks</h2>
        <ul>
          <li>Longest streak: {totals.longest_streak} days</li>
          <li>Current streak: {mine.current_streak} days</li>
        </ul>
      </section>
      <section>
        <h2>Games per day</h2>
        <ul>
          {mine.daily
            .filter((d) => d.games > 0)
            .map((d) => (
              <li key={d.day}>{d.day}: {d.games}</li>
            ))}
        </ul>
      </section>
    </>
  );
}

export default function Stats({ online, onBack }: { online: boolean; onBack: () => void }) {
  const [answer, setAnswer] = useState<StatsAnswer | null>(null);
  const [failed, setFailed] = useState(false);

  const ask = useCallback(async () => {
    setFailed(false);
    try {
      setAnswer(await loadStats(localDay()));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (online) void ask();
  }, [online, ask]);

  return (
    <main className="shell stats-screen">
      <button type="button" className="back" onClick={onBack}>Back to home</button>
      <h1 className="stats-title">Stats</h1>
      {answer && <Totals answer={answer} />}
      {!answer && !online && <p className="stats-note">Stats need a connection.</p>}
      {!answer && online && failed && (
        <>
          <p className="stats-note">That did not work.</p>
          <button type="button" className="back" onClick={() => void ask()}>Try again</button>
        </>
      )}
    </main>
  );
}
