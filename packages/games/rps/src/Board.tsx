/**
 * Rock Paper Scissors board (web only). Pure presentation: renders `RpsView`, sends `{ pick }`
 * intents. The view never contains the opponent's pick for the current round, so neither does
 * this board. Styling uses the web app's Sticker Arcade tokens.
 */
import type { BoardProps } from '@coinclash/game-sdk';
import type { Pick, RpsMove, RpsRoundView, RpsView } from './engine.js';
import './board.css';

const LABEL: Readonly<Record<Pick, string>> = {
  rock: 'Rock',
  paper: 'Paper',
  scissors: 'Scissors',
};

const FILL: Readonly<Record<Pick, string>> = {
  rock: 'var(--cc-sunflower)',
  paper: 'var(--cc-white)',
  scissors: 'var(--cc-teal)',
};

/** Flat sticker glyphs: 3px ink stroke, token fills. */
export function PickIcon({ pick }: { pick: Pick }) {
  const common = {
    viewBox: '0 0 48 48',
    'aria-hidden': true,
    className: 'rps__icon',
    fill: 'none',
    stroke: 'var(--cc-ink)',
    strokeWidth: 3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (pick) {
    case 'rock':
      return (
        <svg {...common}>
          <path
            d="M10 28c-2-7 2-15 9-17 5-2 9 0 13 1 6 2 9 8 7 15-1 7-7 12-15 12-7 0-12-4-14-11z"
            fill={FILL.rock}
          />
          <path d="M18 20c2-1 4-1 6 1M28 30c2 0 4-1 5-3" />
        </svg>
      );
    case 'paper':
      return (
        <svg {...common}>
          <path d="M13 6h16l8 8v28H13z" fill={FILL.paper} />
          <path d="M29 6v8h8M18 22h14M18 28h14M18 34h9" />
        </svg>
      );
    case 'scissors':
      return (
        <svg {...common}>
          <circle cx="13" cy="35" r="6" fill={FILL.scissors} />
          <circle cx="35" cy="35" r="6" fill={FILL.scissors} />
          <path d="M17 30L36 6M31 30L12 6" />
        </svg>
      );
  }
}

function roundOutcome(r: RpsRoundView, self: string): 'won' | 'lost' | 'draw' {
  if (r.winner === null) return 'draw';
  return r.winner === self ? 'won' : 'lost';
}

export function RpsBoard({ view, you, canMove, onMove }: BoardProps<RpsView, RpsMove>) {
  const me = view.you ?? you;
  const [p0, p1] = view.players;
  // Observers watch from seat 0's side.
  const self = me ?? p0;
  const them = self === p0 ? p1 : p0;
  const myScore = view.score[self] ?? 0;
  const theirScore = view.score[them] ?? 0;
  const last = view.history.at(-1);
  const picked = view.picked[self] ?? false;
  const theyPicked = view.picked[them] ?? false;

  let status: string;
  if (view.over) status = 'Match over';
  else if (picked) status = 'Waiting for opponent…';
  else if (theyPicked) status = 'They’ve picked. Your move!';
  else status = 'Make your pick';

  return (
    <div className="rps" aria-label="Rock Paper Scissors board" role="group">
      <div className="rps__top">
        <p className="rps__score" aria-label={`Score: you ${myScore}, them ${theirScore}`}>
          <span>You {myScore}</span>
          <span aria-hidden="true">–</span>
          <span>{theirScore} Them</span>
        </p>
        <p className="rps__round">
          Round {view.round}
          <span className="rps__sub"> · first to {view.winsNeeded}</span>
        </p>
      </div>

      {last && (
        <div
          // Remount per round so the reveal animation replays.
          key={view.history.length}
          className={`rps__reveal rps__reveal--${roundOutcome(last, self)}`}
          role="status"
          aria-label={`Round ${last.round}: you ${last.picks[self] ?? 'ran out of time'}, them ${
            last.picks[them] ?? 'ran out of time'
          }`}
        >
          <Clash mine={last.picks[self] ?? null} theirs={last.picks[them] ?? null} />
          <RevealSide pick={last.picks[self] ?? null} who="You" />
          <span className="rps__vs">vs</span>
          <RevealSide pick={last.picks[them] ?? null} who="Them" flip />
          <p className="rps__verdict">
            {last.winner === null
              ? 'Tie round, go again!'
              : last.winner === self
                ? 'You win the round!'
                : 'They win the round'}
          </p>
        </div>
      )}

      <p className="rps__status" aria-live="polite">
        {status}
      </p>

      <div className="rps__picks">
        {(['rock', 'paper', 'scissors'] as const).map((pick) => {
          const chosen = view.yourPick === pick;
          return (
            <button
              key={pick}
              type="button"
              className={`rps__pick${chosen ? ' rps__pick--chosen' : ''}`}
              style={{ background: FILL[pick] }}
              aria-pressed={chosen}
              disabled={!canMove}
              onClick={() => canMove && onMove({ pick })}
            >
              <PickIcon pick={pick} />
              <span>{LABEL[pick]}</span>
            </button>
          );
        })}
      </div>

      {view.history.length > 0 && (
        <ol className="rps__history" aria-label="Rounds">
          {view.history.map((r) => {
            const o = roundOutcome(r, self);
            return (
              <li key={r.round} className={`rps__chip rps__chip--${o}`}>
                R{r.round} {o === 'won' ? 'W' : o === 'lost' ? 'L' : 'Tie'}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function TimeoutIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      className="rps__icon"
      fill="none"
      stroke="var(--cc-ink)"
      strokeWidth={3}
      strokeLinecap="round"
    >
      <circle cx="24" cy="26" r="15" fill="var(--cc-paper)" />
      <path d="M24 17v9l6 4M20 6h8" />
    </svg>
  );
}

/** What beats what, and the verb for it. */
const BEATS: Record<Pick, { beats: Pick; kind: 'covers' | 'breaks' | 'cut' }> = {
  paper: { beats: 'rock', kind: 'covers' },
  rock: { beats: 'scissors', kind: 'breaks' },
  scissors: { beats: 'paper', kind: 'cut' },
};

export function clashOf(mine: Pick | null, theirs: Pick | null) {
  if (!mine || !theirs) return null;
  if (mine === theirs) return { kind: 'tie' as const, winnerSide: null, caption: 'Same pick!' };
  const mineWins = BEATS[mine].beats === theirs;
  const winner = mineWins ? mine : theirs;
  const loser = mineWins ? theirs : mine;
  return {
    kind: BEATS[winner].kind,
    winnerSide: mineWins ? ('left' as const) : ('right' as const),
    caption: `${LABEL[winner]} ${BEATS[winner].kind} ${LABEL[loser].toLowerCase()}`,
  };
}

/**
 * The clash: the winner acts on the loser. Paper covers rock, rock breaks scissors,
 * scissors cut paper (the loser splits in two); a tie bumps and bounces back.
 */
function Clash({ mine, theirs }: { mine: Pick | null; theirs: Pick | null }) {
  const c = clashOf(mine, theirs);
  if (!c || !mine || !theirs) return null;
  const role = (side: 'left' | 'right') =>
    c.winnerSide === null ? 'tie' : c.winnerSide === side ? 'winner' : 'loser';
  const piece = (pick: Pick, side: 'left' | 'right') => {
    const r = role(side);
    const cls = `rps-clash__piece rps-clash__piece--${side} rps-clash__piece--${r}`;
    if (r === 'loser' && c.kind !== 'covers') {
      // Broken or cut: two clipped halves fly apart.
      return (
        <span className={cls} aria-hidden="true">
          <span className="rps-clash__half rps-clash__half--a">
            <PickIcon pick={pick} />
          </span>
          <span className="rps-clash__half rps-clash__half--b">
            <PickIcon pick={pick} />
          </span>
        </span>
      );
    }
    return (
      <span className={cls} aria-hidden="true">
        <PickIcon pick={pick} />
      </span>
    );
  };
  return (
    <div className={`rps-clash rps-clash--${c.kind}`} data-testid="rps-clash">
      <div className="rps-clash__stage">
        {piece(mine, 'left')}
        {piece(theirs, 'right')}
      </div>
      <p className="rps-clash__caption">{c.caption}</p>
    </div>
  );
}

function RevealSide({ pick, who, flip }: { pick: Pick | null; who: string; flip?: boolean }) {
  return (
    <div className={`rps__side${flip ? ' rps__side--flip' : ''}`}>
      <span className="rps__side-icon">{pick ? <PickIcon pick={pick} /> : <TimeoutIcon />}</span>
      <span className="rps__side-label">
        {who}: {pick ? LABEL[pick] : 'Out of time'}
      </span>
    </div>
  );
}

export default RpsBoard;
