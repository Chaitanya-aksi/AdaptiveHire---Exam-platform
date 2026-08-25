import { useEffect, useState } from 'react';
import type { AnswerPayload, RuntimeQuestion } from '../../lib/types';
import { RankingQuestion } from './RankingQuestion';

interface QuestionCardProps {
  question: RuntimeQuestion;
  sequenceNumber: number;
  /** Disables the form while an answer is in flight. */
  busy: boolean;
  onSubmit: (payload: AnswerPayload) => void;
}

/**
 * Prompt shown above the options, by behavioural pattern.
 *
 * Every one of these says the same thing in a different way: there is nothing
 * to score well on. A candidate who believes one option is the "employer
 * answer" gives us their guess at that instead of their behaviour, which is
 * the exact failure mode the behavioural patterns exist to avoid.
 */
const PATTERN_HINT: Record<string, string> = {
  situational:
    'There is no right answer. Choose what you would most likely actually do.',
  forced_choice: 'Both are positive. Choose the one that describes you better.',
  trade_off:
    'Neither is better than the other. Choose the one you would prefer.',
};

/**
 * One question, one answer, no going back. Ranking questions need a different
 * interaction and a different payload, so they are delegated wholesale;
 * everything else — objective, situational, forced-choice, trade-off and
 * legacy Likert — is a single choice.
 *
 * There is no "previous" control anywhere in this component on purpose: the
 * server would reject it, and offering a button that always fails is worse
 * than not offering one.
 */
export function QuestionCard({
  question,
  sequenceNumber,
  busy,
  onSubmit,
}: QuestionCardProps) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => setSelected(null), [question.id]);

  if (question.pattern === 'ranking') {
    return (
      <RankingQuestion
        question={question}
        busy={busy}
        onSubmit={(selectedOptions) => onSubmit({ selectedOptions })}
      />
    );
  }

  const hint = question.pattern ? PATTERN_HINT[question.pattern] : null;
  // Two-option patterns read as a comparison rather than a list, so the CSS
  // lays them out side by side where there is room.
  const pairwise =
    question.pattern === 'forced_choice' || question.pattern === 'trade_off';

  return (
    <form
      className="card card-pad assess-question"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected && !busy) onSubmit({ selectedOption: selected });
      }}
    >
      <p className="assess-qnum">Question {sequenceNumber}</p>
      <h2 className="assess-qtext">{question.text}</h2>
      {hint && <p className="muted small assess-hint">{hint}</p>}

      <div className={`assess-options${pairwise ? ' pairwise' : ''}`}>
        {question.options.map((option) => (
          <label
            key={option.key}
            className={`assess-option${selected === option.key ? ' selected' : ''}`}
          >
            <input
              type="radio"
              name={`q-${question.id}`}
              value={option.key}
              checked={selected === option.key}
              onChange={() => setSelected(option.key)}
              disabled={busy}
            />
            <span className="assess-option-key">{option.key}</span>
            <span>{option.text}</span>
          </label>
        ))}
      </div>

      <div className="assess-actions">
        <p className="muted small" style={{ margin: 0 }}>
          You cannot return to a question once you move on.
        </p>
        <button type="submit" className="primary" disabled={!selected || busy}>
          {busy ? 'Saving…' : 'Save & continue'}
        </button>
      </div>
    </form>
  );
}
