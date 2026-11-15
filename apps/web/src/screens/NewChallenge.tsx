import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorText, ScreenHead } from '../design/components';
import { GameIcon, GAMES } from '../games/registry';
import { useSnapshot, useStoreApi } from '../lib/StoreContext';
import { clampStake, StakeInput } from './StakeInput';

export function NewChallenge() {
  const { config } = useSnapshot();
  const store = useStoreApi();
  const navigate = useNavigate();
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

      <section className="stack" aria-labelledby="pick-h">
        <h2 id="pick-h" className="eyebrow">
          1 · Pick a game
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
          2 · Set the stake
        </h2>
        <Card raised>
          <StakeInput value={stake} onChange={setStake} min={min} max={max} />
        </Card>
      </section>

      <Card dashed>
        <p style={{ margin: 0, fontSize: 'var(--cc-text-sm)' }}>
          Both stakes get <strong>locked</strong> before the game starts. The winner unlocks both.
          CoinClash never holds your sats.
        </p>
      </Card>

      <ErrorText>{error}</ErrorText>
      <div className="spacer" />
      <Button variant="primary" size="lg" block busy={busy} onClick={() => void create()}>
        Create challenge
      </Button>
    </main>
  );
}
