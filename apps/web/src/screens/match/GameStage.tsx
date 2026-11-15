/** Game screen (spec §8.5): board, whose turn, turn timer, pot always visible. */
import type { MatchView } from '@coinclash/shared';
import { useEffect, useRef, useState } from 'react';
import {
  Amount,
  BoardFrame,
  Button,
  ErrorText,
  formatClock,
  Timer,
  useNow,
} from '../../design/components';
import { gameMeta } from '../../games/registry';
import { cue } from '../../lib/feedback';
import { useSnapshot, useStoreApi } from '../../lib/StoreContext';
import { opponentName } from '../../match/describe';

export function GameStage({ view }: { view: MatchView }) {
  const { network } = useSnapshot();
  const store = useStoreApi();
  const now = useNow(500);
  const [error, setError] = useState('');
  const [confirmResign, setConfirmResign] = useState(false);
  const meta = gameMeta(view.gameId);
  const game = view.game!;
  const them = opponentName(view);
  const myTurn = view.you !== null && game.waitingOn.includes(view.you);
  const Board = meta.Board;
  const wasMyTurn = useRef(myTurn);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) cue('turn');
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  const move = (m: unknown) => {
    setError('');
    store
      .send('match:move', { matchId: view.id, move: m })
      .catch((err: Error) => setError(err.message));
  };

  const resign = () => {
    store.send('match:resign', { matchId: view.id }).catch((err: Error) => setError(err.message));
  };

  return (
    <main className="screen">
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <div className="stack" style={{ gap: 0 }}>
          <span className="eyebrow">
            {meta.name} vs {them}
          </span>
          <span className="turn" aria-live="polite">
            {myTurn ? 'Your turn' : `${them}'s turn`}
          </span>
        </div>
        {game.turnEndsAt && <Timer deadline={game.turnEndsAt} label="Turn" />}
      </header>

      <div className="row" style={{ justifyContent: 'center' }}>
        <span className="pill">
          Pot <Amount sats={view.stake * 2} network={network} size="sm" />
        </span>
      </div>

      {view.opponentGraceEndsAt && (
        <p className="banner" role="status">
          {them} lost connection. If they’re not back in{' '}
          {formatClock(view.opponentGraceEndsAt - now)}, you win.
        </p>
      )}

      <BoardFrame>
        {Board ? (
          <Board view={game.view} you={view.you} canMove={myTurn} onMove={move} />
        ) : (
          <p>This game isn’t available in this version yet.</p>
        )}
      </BoardFrame>

      <ErrorText>{error}</ErrorText>
      <div className="spacer" />
      {confirmResign ? (
        <div className="grid-2">
          <Button onClick={() => setConfirmResign(false)}>Keep playing</Button>
          <Button variant="primary" onClick={resign}>
            Yes, resign
          </Button>
        </div>
      ) : (
        <Button block onClick={() => setConfirmResign(true)}>
          Resign
        </Button>
      )}
    </main>
  );
}
