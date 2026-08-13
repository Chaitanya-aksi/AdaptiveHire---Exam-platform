import { useEffect, useState } from 'react';
import type { RuntimeQuestion } from '../../lib/types';

interface RankingQuestionProps {
  question: RuntimeQuestion;
  busy: boolean;
  onSubmit: (orderedKeys: string[]) => void;
}

/**
 * Ranking: the candidate places every option, most like them first.
 *
 * Built as click-to-place rather than a pre-filled list the candidate nudges,
 * for two reasons. A pre-filled list is a default answer, and whichever order
 * the server happened to serve would quietly become the most common response.
 * And an incomplete or duplicated ranking is impossible here by construction —
 * an option is either in the ranking once or in the pool — so the rule is
 * enforced by the shape of the interaction, not by a validation message after
 * the fact. The server rejects both anyway; this just means it never has to.
 *
 * Everything is a real button, so the whole thing is keyboard-operable and
 * announces itself without any drag-and-drop machinery.
 */
export function RankingQuestion({
  question,
  busy,
  onSubmit,
}: RankingQuestionProps) {
  const [ranked, setRanked] = useState<string[]>([]);

  // A new question must never inherit the previous one's ordering.
  useEffect(() => setRanked([]), [question.id]);

  const pool = question.options.filter((o) => !ranked.includes(o.key));
  const complete = ranked.length === question.options.length;
  const textFor = (key: string) =>
    question.options.find((o) => o.key === key)?.text ?? key;

  const place = (key: string) => setRanked((current) => [...current, key]);
  const remove = (key: string) =>
    setRanked((current) => current.filter((k) => k !== key));

  const move = (index: number, delta: number) =>
    setRanked((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  return (
    <form
      className="card card-pad assess-question"
      onSubmit={(event) => {
        event.preventDefault();
        if (complete && !busy) onSubmit(ranked);
      }}
    >
      <p className="assess-qnum">Rank all {question.options.length} options</p>
      <h2 className="assess-qtext">{question.text}</h2>
      <p className="muted small assess-hint">
        There is no right answer here. Place them in the order that genuinely
        describes you, most like you first.
      </p>

      <ol className="rank-list" aria-label="Your ranking so far">
        {ranked.map((key, index) => (
          <li key={key} className="rank-item">
            <span className="rank-position" aria-hidden="true">
              {index + 1}
            </span>
            <span className="rank-text">{textFor(key)}</span>
            <span className="rank-controls">
              <button
                type="button"
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move "${textFor(key)}" up to position ${index}`}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={busy || index === ranked.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move "${textFor(key)}" down to position ${index + 2}`}
              >
                ↓
              </button>
              <button
                type="button"
                className="link"
                disabled={busy}
                onClick={() => remove(key)}
                aria-label={`Remove "${textFor(key)}" from the ranking`}
              >
                Remove
              </button>
            </span>
          </li>
        ))}

        {ranked.length === 0 && (
          <li className="rank-empty muted small">
            Nothing placed yet — choose the one most like you first.
          </li>
        )}
      </ol>

      {pool.length > 0 && (
        <div className="rank-pool">
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            {ranked.length === 0
              ? 'Most like you:'
              : `Next most like you (${pool.length} left):`}
          </p>
          <div className="rank-pool-options">
            {pool.map((option) => (
              <button
                key={option.key}
                type="button"
                className="rank-choice"
                disabled={busy}
                onClick={() => place(option.key)}
              >
                {option.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Politely announced so a screen-reader user knows where they are. */}
      <p className="sr-only" aria-live="polite">
        {ranked.length} of {question.options.length} options placed.
      </p>

      <div className="assess-actions">
        <p className="muted small" style={{ margin: 0 }}>
          You cannot return to a question once you move on.
        </p>
        <div className="row">
          {ranked.length > 0 && (
            <button type="button" disabled={busy} onClick={() => setRanked([])}>
              Start over
            </button>
          )}
          <button type="submit" className="primary" disabled={!complete || busy}>
            {busy ? 'Saving…' : 'Save & continue'}
          </button>
        </div>
      </div>
    </form>
  );
}
