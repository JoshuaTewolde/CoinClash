/**
 * Trivia board (web only). Pure presentation: renders `TriviaView`, sends `{ question, choice }`
 * intents. The server validates every move. After each question it briefly shows the reveal
 * (correct answer teal, a wrong pick tomato). Styling uses the Sticker Arcade tokens.
 */
import type { BoardProps } from '@coinclash/game-sdk';
import { useEffect, useState } from 'react';
import type { PastQuestionView, TriviaMove, TriviaView } from './engine.js';
import './board.css';

/** How long the reveal of the previous question stays up before the next question shows. */
export const REVEAL_MS = 2200;
const LETTERS = ['A', 'B', 'C', 'D'];

function progressLabel(index: number, main: number): string {
  return index < main ? `Q ${index + 1}/${main}` : `Sudden death ${index - main + 1}`;
}

function Reveal({
  past,
  me,
  them,
  onNext,
}: {
  past: PastQuestionView;
  me: string;
  them: string;
  onNext: (() => void) | null;
}) {
  const mine = past.choices[me] ?? null;
  const theirs = past.choices[them] ?? null;
  const headline = past.right[me] ? 'Correct!' : mine === null ? 'Time’s up!' : 'Wrong!';
  return (
    <div className="trivia__reveal" role="status" aria-live="polite">
      <p className={`trivia__verdict${past.right[me] ? ' trivia__verdict--right' : ''}`}>
        {headline}
      </p>
      <p className="trivia__prompt">{past.prompt}</p>
      <ul className="trivia__options" aria-label="Answers">
        {past.options.map((text, i) => {
          const cls =
            i === past.correct
              ? ' trivia__option--correct'
              : i === mine || i === theirs
                ? ' trivia__option--wrong'
                : '';
          return (
            <li key={i} className={`trivia__option trivia__option--static${cls}`}>
              <span className="trivia__letter">{LETTERS[i]}</span>
              <span className="trivia__text">{text}</span>
              {i === mine && <span className="trivia__tag">You</span>}
              {i === theirs && <span className="trivia__tag">Them</span>}
            </li>
          );
        })}
      </ul>
      {onNext && (
        <button type="button" className="trivia__next" onClick={onNext}>
          Next question
        </button>
      )}
    </div>
  );
}

export function TriviaBoard({ view, you, canMove, onMove }: BoardProps<TriviaView, TriviaMove>) {
  const me = you !== null && view.players.includes(you) ? you : view.players[0];
  const them = view.players[0] === me ? view.players[1] : view.players[0];
  const { current, history } = view;
  const last = history[history.length - 1];

  // Reveals already dismissed; starts at the current count so reconnecting doesn't replay one.
  const [seen, setSeen] = useState(history.length);
  const [picked, setPicked] = useState<{ question: number; choice: number } | null>(null);

  useEffect(() => {
    if (history.length <= seen) return;
    const timer = setTimeout(() => setSeen(history.length), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [history.length, seen]);

  const showReveal = last !== undefined && (history.length > seen || current === null);

  const score = (
    <div className="trivia__score" aria-label="Score">
      <span className="trivia__chip">
        You <strong>{view.scores[me] ?? 0}</strong>
      </span>
      <span className="trivia__vs">vs</span>
      <span className="trivia__chip">
        Them <strong>{view.scores[them] ?? 0}</strong>
      </span>
    </div>
  );

  if (showReveal) {
    return (
      <div className="trivia">
        {score}
        <Reveal
          past={last}
          me={me}
          them={them}
          onNext={current ? () => setSeen(history.length) : null}
        />
      </div>
    );
  }

  if (!current) return <div className="trivia">{score}</div>;

  const chosen = current.yourChoice ?? (picked?.question === current.index ? picked.choice : null);
  const locked = !canMove || chosen !== null;
  const theyAnswered = current.answered[them] === true;

  const answer = (choice: number) => {
    if (locked) return;
    setPicked({ question: current.index, choice });
    onMove({ question: current.index, choice });
  };

  return (
    <div className="trivia">
      {score}
      <div className="trivia__card">
        <div className="trivia__meta">
          <span className="trivia__progress">
            {progressLabel(current.index, view.mainQuestions)}
          </span>
          <span className="trivia__category">{current.category}</span>
        </div>
        <p className="trivia__prompt">{current.prompt}</p>
      </div>
      <div className="trivia__options" role="group" aria-label="Answer options">
        {current.options.map((text, i) => (
          <button
            key={i}
            type="button"
            className={`trivia__option${chosen === i ? ' trivia__option--picked' : ''}`}
            aria-label={`Answer ${LETTERS[i]}: ${text}`}
            aria-pressed={chosen === i}
            disabled={locked}
            onClick={() => answer(i)}
          >
            <span className="trivia__letter">{LETTERS[i]}</span>
            <span className="trivia__text">{text}</span>
          </button>
        ))}
      </div>
      <p className="trivia__status" aria-live="polite">
        {chosen !== null
          ? 'Waiting for opponent…'
          : theyAnswered
            ? 'Opponent answered. Your move!'
            : 'Pick an answer'}
      </p>
    </div>
  );
}

export default TriviaBoard;
