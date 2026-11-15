import type { FriendStats, MatchView } from '@coinclash/shared';
import { Link } from 'react-router-dom';
import { Amount, Button, ButtonLink, Card, FlameIcon, Logo, useNow } from '../design/components';
import { NetworkPicker } from '../design/NetworkPicker';
import { GameBadge, gameMeta } from '../games/registry';
import { promptInstall, useCanInstall } from '../lib/install';
import { useSnapshot, useStoreApi } from '../lib/StoreContext';
import { describeMatch, isFinal, opponentName } from '../match/describe';

function MatchRow({ v, now }: { v: MatchView; now: number }) {
  const store = useStoreApi();
  const { network } = useSnapshot();
  const line = describeMatch(v, now, store.hasLocked(v.id));
  return (
    <Link to={`/m/${v.id}`} className={`match-row${line.hot ? ' match-row--hot' : ''}`}>
      <GameBadge id={v.gameId} />
      <span className="match-row__text">
        <strong>
          {gameMeta(v.gameId).name} vs {opponentName(v)}
        </strong>
        <span>{line.text}</span>
      </span>
      <span className="pill">
        <Amount sats={v.stake * 2} network={network} size="sm" />
      </span>
    </Link>
  );
}

function FriendTile({ f }: { f: FriendStats }) {
  const lit = f.streakDays > 0;
  return (
    <Link to={`/friends/${encodeURIComponent(f.id)}`} className="friend-tile">
      <strong>{f.nickname}</strong>
      <span className={`streak${lit ? '' : ' streak--none'}`}>
        <FlameIcon lit={lit} />
        {lit ? `${f.streakDays}-day streak` : 'No streak'}
      </span>
      <span className="muted">
        {f.gamesPlayed} {f.gamesPlayed === 1 ? 'game' : 'games'} played
      </span>
    </Link>
  );
}

export function Home() {
  const { balance, network, matches, friends } = useSnapshot();
  const now = useNow(1000);
  const canInstall = useCanInstall();
  const all = Object.values(matches).sort((a, b) => b.updatedAt - a.updatedAt);
  const live = all.filter((v) => !isFinal(v));
  const recent = all.filter(isFinal).slice(0, 5);

  return (
    <main className="screen">
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <Logo />
        <NetworkPicker />
      </header>

      <Card raised aria-label="Your wallet">
        <span className="eyebrow">Your wallet</span>
        {balance === null ? (
          <span className="muted">Loading balance…</span>
        ) : (
          <Amount sats={balance} network={network} size="lg" />
        )}
      </Card>

      <ButtonLink to="/new" variant="primary" size="lg" block>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        New challenge
      </ButtonLink>

      <section className="stack" aria-labelledby="live-h">
        <h2 id="live-h" className="section-title">
          Live matches
        </h2>
        {live.length === 0 ? (
          <p className="muted">No live matches. Challenge a friend to start one.</p>
        ) : (
          live.map((v) => <MatchRow key={v.id} v={v} now={now} />)
        )}
      </section>

      {friends.length > 0 && (
        <section className="stack" aria-labelledby="friends-h">
          <h2 id="friends-h" className="section-title">
            Friends
          </h2>
          <div className="grid-2">
            {friends.map((f) => (
              <FriendTile key={f.id} f={f} />
            ))}
          </div>
        </section>
      )}

      {canInstall && (
        <Card tone="sun" aria-label="Install">
          <strong>Put CoinClash on your home screen</strong>
          <span className="muted">
            Opens full-screen, like an app. Challenges are one tap away.
          </span>
          <Button variant="plain" onClick={() => void promptInstall()}>
            Install app
          </Button>
        </Card>
      )}

      {recent.length > 0 && (
        <section className="stack" aria-labelledby="recent-h">
          <h2 id="recent-h" className="section-title">
            Recent
          </h2>
          {recent.map((v) => (
            <MatchRow key={v.id} v={v} now={now} />
          ))}
        </section>
      )}
    </main>
  );
}
