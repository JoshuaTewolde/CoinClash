import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, ErrorText, ScreenHead, SecuredBadge } from '../design/components';
import { GameIcon, GAMES } from '../games/registry';
import { useSnapshot, useStoreApi } from '../lib/StoreContext';
import { clampStake, StakeInput } from './StakeInput';

export function NewChallenge() {
  const { config, friends } = useSnapshot();
  const store = useStoreApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // null = "Anyone · send a link / QR / code"; otherwise a friend's id (direct challenge).
  const [who, setWho] = useState<string | null>(() => {
    const f = params.get('friend');
    return f && friends.some((x) => x.id === f) ? f : null;
  });
  const friend = friends.find((f) => f.id === who);
  const playable = new Set(config?.games.map((g) => g.id) ?? []);
  const [game, setGame] = useState(() => GAMES.find((g) => playable.has(g.id))?.id ?? 'tictactoe');
  const min = config?.stakeMin ?? 100;
  const max = config?.stakeMax ?? 100_000;
  const [stake, setStake] = useState(() => clampStake(2000, min, max));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const v = await store.send('match:create', {
        gameId: game,
        stake: clampStake(stake, min, max),
        ...(who ? { opponentId: who } : {}),
      });
      navigate(`/m/${v.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the challenge');
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <ScreenHead title="New challenge" back="/" />

      <section className="stack" aria-labelledby="who-h">
        <h2 id="who-h" className="eyebrow">
          1 · Who?
        </h2>
        <div className="chips" role="radiogroup" aria-label="Opponent">
          {friends.map((f) => (
            <button
              key={f.id}
              type="button"
              className="chip"
              role="radio"
              aria-checked={who === f.id}
              aria-pressed={who === f.id}
              onClick={() => setWho(f.id)}
            >
              {f.nickname}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            role="radio"
            aria-checked={who === null}
            aria-pressed={who === null}
            onClick={() => setWho(null)}
          >
            Anyone · send a link
          </button>
        </div>
        {friends.length === 0 && (
          <span className="muted">
            Play someone once and they’ll show up here, so you can challenge them without a link.
          </span>
        )}
      </section>

      <section className="stack" aria-labelledby="pick-h">
        <h2 id="pick-h" className="eyebrow">
          2 · Pick a game
        </h2>
        <div className="grid-2">
          {GAMES.map((g) => {
            const enabled = playable.has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                className="game-tile"
                style={{ background: g.color }}
                aria-pressed={g.id === game}
                disabled={!enabled}
                onClick={() => setGame(g.id)}
              >
                <GameIcon id={g.id} />
                <span>
                  {g.name}
                  {!enabled && <span className="game-tile__soon">Coming soon</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="stack" aria-labelledby="stake-h">
        <h2 id="stake-h" className="eyebrow">
          3 · Set the stake
        </h2>
        <Card raised>
          <StakeInput value={stake} onChange={setStake} min={min} max={max} />
        </Card>
      </section>

      <Card dashed>
        <SecuredBadge />
        <p style={{ margin: 0, fontSize: 'var(--cc-text-sm)' }}>
          Both stakes are <strong>secured</strong> before the game starts. The winner gets the whole
          pot instantly.
        </p>
      </Card>

      <ErrorText>{error}</ErrorText>
      <div className="spacer" />
      <Button variant="primary" size="lg" block busy={busy} onClick={() => void create()}>
        {friend ? `Challenge ${friend.nickname}` : 'Create challenge'}
      </Button>
    </main>
  );
}
