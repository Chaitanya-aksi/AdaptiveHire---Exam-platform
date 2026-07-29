import { useEffect, useState } from 'react';
import type { RuntimeQuestion } from '../../lib/types';

interface QuestionCardProps {
  question: RuntimeQuestion;
  sequenceNumber: number;
  /** Disables the form while an answer is in flight. */
  busy: boolean;
  onSubmit: (option: string) => void;
}

/**
 * One question, one answer, no going back — the selection resets whenever the
 * question changes so a stale choice can't be carried forward.
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

  return (
    <form
      className="card card-pad assess-question"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected && !busy) onSubmit(selected);
      }}
    >
      <p className="assess-qnum">Question {sequenceNumber}</p>
      <h2 className="assess-qtext">{question.text}</h2>

      <div className="assess-options">
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
