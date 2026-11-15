/** Friend detail (ADR 0009): streak plus the win/loss record per game. */
import { useParams } from 'react-router-dom';
import { ButtonLink, Card, FlameIcon, ScreenHead } from '../design/components';
import { GameBadge, gameMeta } from '../games/registry';
import { useSnapshot } from '../lib/StoreContext';

export function Friend() {
  const { id = '' } = useParams();
  const { friends } = useSnapshot();
  const f = friends.find((x) => x.id === id);
  if (!f)
    return (
      <main className="screen">
        <ScreenHead title="Friend" back="/" />
        <p className="muted">No finished games with this friend yet.</p>
      </main>
    );

  return (
    <main className="screen">
      <ScreenHead title={f.nickname} back="/" />
      <Card raised tone="sun">
        <span
          className={`streak${f.streakDays ? '' : ' streak--none'}`}
          style={{ fontSize: 'var(--cc-text-xl)' }}
        >
          <FlameIcon lit={f.streakDays > 0} />
          {f.streakDays ? `${f.streakDays}-day streak` : 'No streak'}
        </span>
        <span>
          {f.gamesPlayed} {f.gamesPlayed === 1 ? 'game' : 'games'} played · {f.record.wins}W{' '}
          {f.record.losses}L {f.record.draws}D
        </span>
      </Card>
      <section className="stack" aria-labelledby="by-game">
        <h2 id="by-game" className="section-title">
          By game
        </h2>
        {Object.entries(f.byGame).map(([gameId, r]) => (
          <div key={gameId} className="match-row">
            <GameBadge id={gameId} />
            <span className="match-row__text">
              <strong>{gameMeta(gameId).name}</strong>
              <span>
                {r.wins} won · {r.losses} lost · {r.draws} drawn
              </span>
            </span>
          </div>
        ))}
      </section>
      <div className="spacer" />
      <ButtonLink to="/new" variant="primary" size="lg" block>
        Challenge {f.nickname}
      </ButtonLink>
    </main>
  );
}
