/**
 * Practice (ADR 0017): play any game against a bot, free, no account needed. The engine runs in
 * the browser; nothing touches the server or a wallet.
 */
import {
  sessionResult,
  startSession,
  submitMove,
  waitingOn,
  type GameSession,
} from '@coinclash/game-sdk';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BoardFrame,
  Button,
  ButtonLink,
  Card,
  CoinBurst,
  ErrorText,
  ScreenHead,
} from '../design/components';
import { GameIcon, GAMES, gameMeta } from '../games/registry';
import { useSnapshot } from '../lib/StoreContext';
import { BOT, botMove, ENGINES, YOU } from '../practice/bot';

const BOT_NAME = 'CoinBot';

function newSeed(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function newSession(gameId: string): GameSession<unknown> {
  // Coin flip for who goes first.
  const players = Math.random() < 0.5 ? [YOU, BOT] : [BOT, YOU];
  return startSession(ENGINES[gameId]!, { players, seed: newSeed() });
}

/** Bot "thinking" time; pool waits for the last shot's replay to finish. */
const botDelay = (gameId: string, s: GameSession<unknown>) =>
  gameId === 'pool' ? (s.events.length ? 4200 : 1200) : 650;

function PracticeGame({ gameId }: { gameId: string }) {
  const plugin = ENGINES[gameId]!;
  const meta = gameMeta(gameId);
  const { phase } = useSnapshot();
  const [session, setSession] = useState(() => newSession(gameId));
  const [error, setError] = useState('');

  const result = sessionResult(plugin, session);
  const waiting = waitingOn(plugin, session);
  const myTurn = waiting.includes(YOU);
  const botTurn = waiting.includes(BOT);

  useEffect(() => {
    if (!botTurn) return;
    const t = setTimeout(
      () => {
        setSession((s) => {
          const m = botMove(gameId, s);
          if (m === null) return s;
          const out = submitMove(plugin, s, BOT, m);
          return out.ok ? out.session : s;
        });
      },
      botDelay(gameId, session),
    );
    return () => clearTimeout(t);
  }, [botTurn, session, gameId, plugin]);

  const move = (m: unknown) => {
    setError('');
    const out = submitMove(plugin, session, YOU, m);
    if (out.ok) setSession(out.session);
    else setError(out.reason);
  };

  const over = result.status !== 'ongoing';
  const won = result.status === 'win' && result.winner === YOU;
  const Board = meta.Board;
  const view = plugin.viewFor(session.state, YOU) as unknown;

  return (
    <main className="screen">
      <ScreenHead title={`${meta.name} · Practice`} back="/practice" />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="turn" aria-live="polite">
          {over ? 'Game over' : myTurn ? 'Your turn' : `${BOT_NAME} is thinking…`}
        </span>
        <span className="pill">Free · no sats</span>
      </div>

      {over && (
        <Card raised tone={won ? 'sun' : result.status === 'draw' ? 'paper' : undefined}>
          {won && <CoinBurst />}
          <h2 style={{ margin: 0 }}>
            {won ? 'You won!' : result.status === 'draw' ? 'Draw' : `${BOT_NAME} won`}
          </h2>
          <span className="muted">
            {won
              ? 'Now try it against a friend, for real sats.'
              : 'Practice makes perfect. Go again?'}
          </span>
        </Card>
      )}

      <BoardFrame>
        {Board && (
          <Board
            key={session.ctx.seed}
            view={view}
            you={YOU}
            canMove={myTurn}
            onMove={move}
            mode="play"
          />
        )}
      </BoardFrame>
      <ErrorText>{error}</ErrorText>

      <div className="spacer" />
      <div className="grid-2">
        <Button
          variant={over ? 'primary' : undefined}
          onClick={() => {
            setError('');
            setSession(newSession(gameId));
          }}
        >
          {over ? 'Play again' : 'Restart'}
        </Button>
        <ButtonLink to={phase === 'ready' ? `/new` : '/'} variant={over ? undefined : 'primary'}>
          {phase === 'ready' ? 'Play a friend' : 'Sign up to play friends'}
        </ButtonLink>
      </div>
    </main>
  );
}

export function Practice() {
  const { gameId } = useParams();
  const { phase } = useSnapshot();
  if (gameId && ENGINES[gameId]) return <PracticeGame key={gameId} gameId={gameId} />;
  return (
    <main className="screen">
      <ScreenHead title="Practice" back="/" />
      <Card tone="sun" raised>
        <p style={{ margin: 0 }}>
          Play {BOT_NAME} for free. No sats, no account. When you’re ready, challenge a friend.
        </p>
      </Card>
      <div className="grid-2">
        {GAMES.filter((g) => ENGINES[g.id]).map((g) => (
          <Link
            key={g.id}
            to={`/practice/${g.id}`}
            className="game-tile"
            style={{ background: g.color }}
          >
            <GameIcon id={g.id} />
            <span>{g.name}</span>
          </Link>
        ))}
      </div>
      {phase !== 'ready' && (
        <>
          <div className="spacer" />
          <ButtonLink to="/" block>
            Back to sign up
          </ButtonLink>
        </>
      )}
    </main>
  );
}
