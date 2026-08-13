import { useMemo, useState } from 'react';
import { questionsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type {
  BehavioralPattern,
  ModuleCatalogEntry,
  PersonalityOption,
  Question,
  QuestionDraft,
  QuestionStatus,
} from '../../lib/types';

/** Option letters, matching the importer. */
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** The -3..+3 authoring scale, as a picker so out-of-range is unreachable. */
const WEIGHTS = [3, 2, 1, 0, -1, -2, -3];

const PATTERN_LABEL: Record<BehavioralPattern, string> = {
  situational: 'Situational — a workplace scenario, one choice',
  forced_choice: 'Forced choice — two equally positive alternatives',
  trade_off: 'Trade-off — two competing priorities',
  ranking: 'Ranking — every option ordered, most like you first',
};

/**
 * Example wording per pattern, shown as placeholders.
 *
 * The four patterns ask for genuinely different shapes of question, so a single
 * shared example actively misled: an author picking Ranking saw a situational
 * scenario ("your teammate is struggling — what would you do?") and a stem
 * written that way cannot be ranked at all. The stem shows the shape of the
 * question, and `option` the shape of one choice — a full sentence for a
 * situational, a short phrase for a ranking.
 *
 * `legacy` covers the agree/disagree items that predate the patterns. It is only
 * ever shown while editing one of those; nothing new can be authored as legacy.
 */
const PATTERN_EXAMPLE: Record<
  BehavioralPattern | 'legacy',
  { stem: string; option: string }
> = {
  situational: {
    stem: 'A teammate is going to miss an important deadline and has told nobody. What would you most likely do?',
    option: 'Work through the blocker with them so they can finish it themselves',
  },
  forced_choice: {
    stem: 'Which of these is more true of you?',
    option: 'I would rather lead the discussion',
  },
  trade_off: {
    stem: 'A release is due on Friday with two checks still outstanding. Which would you prefer?',
    option: 'Ship on Friday and accept a few rough edges',
  },
  ranking: {
    stem: 'Rank these from most like you to least like you.',
    option: 'Planning the work out before starting',
  },
  legacy: {
    stem: 'I plan my week in advance.',
    option: 'Strongly agree',
  },
};

/**
 * Option counts per question kind. Mirrors PATTERN_OPTION_BOUNDS on the server,
 * which stays authoritative — this exists so the form guides the author rather
 * than letting them build something the API will reject.
 */
const BOUNDS: Record<string, { min: number; max: number }> = {
  situational: { min: 3, max: 6 },
  forced_choice: { min: 2, max: 2 },
  trade_off: { min: 2, max: 2 },
  ranking: { min: 3, max: 6 },
  legacy: { min: 4, max: 6 },
  mcq: { min: 4, max: 6 },
};

interface DraftOption {
  key: string;
  text: string;
  behavior: string;
  traitWeights: Record<string, number>;
}

interface QuestionEditorProps {
  modules: ModuleCatalogEntry[];
  /** Null to create; an existing question to edit. */
  question: Question | null;
  /**
   * `editedId` is the id the form was opened on. It differs from `question.id`
   * when a platform question was edited, because that takes a private copy rather
   * than changing shared content — the caller needs both to update its list.
   */
  onSaved: (question: Question, created: boolean, editedId?: string) => void;
  onCancel: () => void;
}

export function QuestionEditor({
  modules,
  question,
  onSaved,
  onCancel,
}: QuestionEditorProps) {
  const editing = question !== null;

  const [moduleId, setModuleId] = useState(
    question?.moduleId ?? modules[0]?.id ?? '',
  );
  const [questionText, setQuestionText] = useState(question?.questionText ?? '');
  const [status, setStatus] = useState<QuestionStatus>(
    question?.status ?? 'draft',
  );
  const [tags, setTags] = useState((question?.tags ?? []).join(', '));
  const [probeGroup, setProbeGroup] = useState(question?.probeGroup ?? '');
  const [pattern, setPattern] = useState<BehavioralPattern | ''>(
    question?.personalityDetails?.pattern ?? '',
  );
  const [correctOption, setCorrectOption] = useState(
    question?.mcqDetails?.correctOption ?? 'A',
  );
  const [difficulty, setDifficulty] = useState(
    String(question?.mcqDetails?.difficultyScore ?? 1000),
  );
  const [options, setOptions] = useState<DraftOption[]>(() =>
    initialOptions(question),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const module = modules.find((m) => m.id === moduleId);
  const isTrait = module?.scoringType === 'trait';
  const traits = useMemo(() => module?.traits ?? [], [module]);
  const bounds = isTrait ? BOUNDS[pattern || 'legacy'] : BOUNDS.mcq;

  /**
   * Whose example wording to show, or null when there is nothing to show yet.
   *
   * An empty `pattern` means two different things: a new question where nobody
   * has chosen one, and an existing legacy item being edited. Only the second
   * should see the agree/disagree example — offering it while creating would
   * illustrate a shape the form will not let you save.
   */
  const exampleKey: BehavioralPattern | 'legacy' | null = pattern
    ? pattern
    : editing
      ? 'legacy'
      : null;
  const example = isTrait && exampleKey ? PATTERN_EXAMPLE[exampleKey] : null;

  /** Answered questions carry history that editing silently rewrites. */
  const timesUsed =
    question?.mcqDetails?.timesUsed ?? question?.personalityDetails?.timesUsed ?? 0;

  const patch = (index: number, changes: Partial<DraftOption>) =>
    setOptions((current) =>
      current.map((o, i) => (i === index ? { ...o, ...changes } : o)),
    );

  const addOption = () =>
    setOptions((current) => {
      // Next unused letter rather than a re-letter of the whole list: option
      // keys are stored on every past response, so they must stay stable.
      const used = new Set(current.map((o) => o.key));
      const key = LETTERS.find((l) => !used.has(l)) ?? `O${current.length + 1}`;
      return [...current, { key, text: '', behavior: '', traitWeights: {} }];
    });

  const removeOption = (index: number) =>
    setOptions((current) => current.filter((_, i) => i !== index));

  const setWeight = (index: number, trait: string, weight: number) =>
    patch(index, {
      traitWeights: { ...options[index].traitWeights, [trait]: weight },
    });

  const dropWeight = (index: number, trait: string) => {
    const next = { ...options[index].traitWeights };
    delete next[trait];
    patch(index, { traitWeights: next });
  };

  /** Everything the API would reject, caught here with a clearer message. */
  const validate = (): string | null => {
    if (!moduleId) return 'Choose a subject.';
    if (questionText.trim().length < 3) return 'Question text is too short.';
    if (isTrait && !pattern && !editing) return 'Choose a question pattern.';

    if (options.length < bounds.min || options.length > bounds.max) {
      const label = isTrait ? pattern || 'legacy' : 'multiple-choice';
      const expected =
        bounds.min === bounds.max
          ? `exactly ${bounds.min}`
          : `${bounds.min}-${bounds.max}`;
      return `A ${label} question takes ${expected} options — there are ${options.length}.`;
    }
    if (options.some((o) => !o.text.trim())) return 'Every option needs text.';

    if (isTrait) {
      const bare = options.find(
        (o) => Object.keys(o.traitWeights).length === 0,
      );
      if (bare) {
        return `Option ${bare.key} must weight at least one trait — every option contributes to the profile, including the ones ranked last.`;
      }
    } else if (!options.some((o) => o.key === correctOption)) {
      return 'Mark which option is correct.';
    }

    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    const draft: QuestionDraft = {
      questionText: questionText.trim(),
      status,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      // Always sent, so clearing the box actually removes the pairing rather
      // than leaving the previous group in place.
      probeGroup: probeGroup.trim(),
      ...(isTrait
        ? {
            personality: {
              // Omitted when blank, which leaves a legacy question's null
              // pattern untouched instead of relabelling it.
              ...(pattern && { pattern }),
              options: options.map<PersonalityOption>((o) => ({
                key: o.key,
                text: o.text.trim(),
                traitWeights: o.traitWeights,
                ...(o.behavior.trim() && { behavior: o.behavior.trim() }),
              })),
            },
          }
        : {
            mcq: {
              options: options.map((o) => ({ key: o.key, text: o.text.trim() })),
              correctOption,
              difficultyScore: Number(difficulty),
            },
          }),
    };

    setSaving(true);
    setError(null);
    try {
      const saved = editing
        ? await questionsApi.update(question.id, draft)
        : await questionsApi.create(moduleId, draft);
      onSaved(saved, !editing, question?.id);
    } catch (err) {
      setError(describeError(err, 'Could not save that question.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="card card-pad qe"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 style={{ margin: 0 }}>
            {editing ? 'Edit question' : 'New question'}
          </h2>
          {module && (
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              {module.name} ·{' '}
              {isTrait
                ? 'behavioural — no correct answer, options carry trait weights'
                : 'objective — one correct answer, Elo-scored'}
            </p>
          )}
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {timesUsed > 0 && (
        <div className="alert">
          Candidates have already answered this question {timesUsed} time
          {timesUsed === 1 ? '' : 's'}. Editing the options changes what those
          stored answers meant — reword freely, but avoid repurposing an option
          into a different choice.
        </div>
      )}

      <div className="qe-grid">
        <label className="field">
          <span>Subject</span>
          <select
            value={moduleId}
            disabled={editing}
            onChange={(e) => {
              setModuleId(e.target.value);
              setPattern('');
              setOptions(blankOptions(4));
            }}
          >
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {editing && (
            <span className="muted small">
              A question can&rsquo;t change subject — its scoring type would
              change with it.
            </span>
          )}
        </label>

        <label className="field">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as QuestionStatus)}
          >
            <option value="draft">Draft — not served to candidates</option>
            <option value="active">Active — in rotation</option>
            <option value="archived">Archived — withdrawn</option>
          </select>
        </label>
      </div>

      {isTrait && (
        <label className="field">
          <span>Question pattern</span>
          <select
            value={pattern}
            onChange={(e) => {
              const next = e.target.value as BehavioralPattern | '';
              setPattern(next);
              // Forced-choice and trade-off are exactly two; trim rather than
              // let the author discover it at save time.
              const max = BOUNDS[next || 'legacy'].max;
              const min = BOUNDS[next || 'legacy'].min;
              setOptions((current) =>
                current.length > max
                  ? current.slice(0, max)
                  : current.length < min
                    ? [...current, ...blankOptions(min - current.length, current)]
                    : current,
              );
            }}
          >
            {editing && question?.personalityDetails?.pattern === null && (
              <option value="">Legacy agree/disagree — leave unchanged</option>
            )}
            {!editing && <option value="">Choose a pattern…</option>}
            {(Object.keys(PATTERN_LABEL) as BehavioralPattern[]).map((p) => (
              <option key={p} value={p}>
                {PATTERN_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span>Question text</span>
        <textarea
          rows={3}
          value={questionText}
          placeholder={
            isTrait
              ? example
                ? `e.g. ${example.stem}`
                : 'Choose a question pattern above to see an example'
              : 'e.g. What is 15% of 240?'
          }
          onChange={(e) => setQuestionText(e.target.value)}
        />
      </label>

      {!isTrait && (
        <label className="field" style={{ maxWidth: 260 }}>
          <span>Difficulty (400–1600)</span>
          <input
            type="number"
            min={400}
            max={1600}
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          />
          <span className="muted small">
            A starting estimate — the engine adjusts it as candidates answer.
          </span>
        </label>
      )}

      <div className="qe-options-head">
        <h3 style={{ margin: 0, fontSize: 15 }}>
          Options{' '}
          <span className="muted small">
            ({bounds.min === bounds.max
              ? `exactly ${bounds.min}`
              : `${bounds.min}–${bounds.max}`}
            )
          </span>
        </h3>
        {options.length < bounds.max && (
          <button type="button" onClick={addOption}>
            Add option
          </button>
        )}
      </div>

      {isTrait && pattern === 'ranking' && (
        <p className="muted small" style={{ margin: 0 }}>
          Every option needs trait weights — the candidate places all of them,
          and where they put each one changes how much it contributes.
        </p>
      )}

      <div className="qe-options">
        {options.map((option, index) => (
          <div key={option.key} className="qe-option">
            <div className="qe-option-head">
              <span className="assess-option-key">{option.key}</span>
              {!isTrait && (
                <label className="qe-correct">
                  <input
                    type="radio"
                    name="correct"
                    checked={correctOption === option.key}
                    onChange={() => setCorrectOption(option.key)}
                  />
                  <span>Correct answer</span>
                </label>
              )}
              {options.length > bounds.min && (
                <button
                  type="button"
                  className="link danger-link"
                  onClick={() => removeOption(index)}
                >
                  Remove
                </button>
              )}
            </div>

            {/* The example goes on the first row only. Repeating it down every
                option would read as four identical suggestions rather than one
                illustration of the shape a choice should take. */}
            <textarea
              rows={2}
              value={option.text}
              placeholder={
                index === 0 && example ? `e.g. ${example.option}` : 'Option text'
              }
              onChange={(e) => patch(index, { text: e.target.value })}
            />

            {isTrait && (
              <>
                <label className="field">
                  <span className="muted small">
                    Behaviour label (optional) — shown to recruiters as evidence
                  </span>
                  <input
                    value={option.behavior}
                    placeholder="e.g. Coaching, Escalating, Independent"
                    onChange={(e) => patch(index, { behavior: e.target.value })}
                  />
                </label>

                <TraitWeights
                  traits={traits}
                  weights={option.traitWeights}
                  onSet={(trait, weight) => setWeight(index, trait, weight)}
                  onDrop={(trait) => dropWeight(index, trait)}
                />
              </>
            )}
          </div>
        ))}
      </div>

      <label className="field">
        <span>Tags (comma separated)</span>
        <input
          value={tags}
          placeholder="deadline-pressure, integrity"
          onChange={(e) => setTags(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Repeat-check group (optional)</span>
        <input
          value={probeGroup}
          placeholder="pg-teammate-struggling"
          maxLength={80}
          onChange={(e) => setProbeGroup(e.target.value)}
        />
        <span className="muted small">
          Give two questions in this module the same group and the engine will
          serve one, wait about eight questions, then serve the other and compare
          the answers. Write the second one as a genuinely different scenario
          with differently worded options — if the candidate spots the repeat,
          they will just answer it the same way and the check proves nothing.
        </span>
      </label>

      <div className="assess-actions">
        <span className="muted small">
          {isTrait
            ? 'No option is correct here. Weights say what each choice indicates.'
            : 'Exactly one option is correct.'}
        </span>
        <div className="row">
          <button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create question'}
          </button>
        </div>
      </div>
    </form>
  );
}

/** Per-option trait weights: only the traits the author actually assigns. */
function TraitWeights({
  traits,
  weights,
  onSet,
  onDrop,
}: {
  traits: { key: string; label: string }[];
  weights: Record<string, number>;
  onSet: (trait: string, weight: number) => void;
  onDrop: (trait: string) => void;
}) {
  const assigned = Object.keys(weights);
  const available = traits.filter((t) => !assigned.includes(t.key));

  return (
    <div className="qe-traits">
      {assigned.length === 0 && (
        <span className="muted small">
          No traits yet — every option must weight at least one.
        </span>
      )}

      {assigned.map((key) => (
        <span key={key} className="qe-trait">
          <span className="qe-trait-name">
            {traits.find((t) => t.key === key)?.label ?? key}
          </span>
          <select
            value={weights[key]}
            onChange={(e) => onSet(key, Number(e.target.value))}
          >
            {WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {w > 0 ? `+${w}` : w}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="link"
            onClick={() => onDrop(key)}
            aria-label={`Remove ${key} weighting`}
          >
            ×
          </button>
        </span>
      ))}

      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && onSet(e.target.value, 1)}
          aria-label="Add a trait weighting"
        >
          <option value="">+ Add trait…</option>
          {available.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function blankOptions(count: number, existing: DraftOption[] = []) {
  const used = new Set(existing.map((o) => o.key));
  const out: DraftOption[] = [];
  for (const letter of LETTERS) {
    if (out.length === count) break;
    if (used.has(letter)) continue;
    out.push({ key: letter, text: '', behavior: '', traitWeights: {} });
  }
  return out;
}

function initialOptions(question: Question | null): DraftOption[] {
  if (question?.personalityDetails) {
    return question.personalityDetails.options.map((o) => ({
      key: o.key,
      text: o.text,
      behavior: o.behavior ?? '',
      traitWeights: { ...o.traitWeights },
    }));
  }
  if (question?.mcqDetails) {
    return question.mcqDetails.options.map((o) => ({
      key: o.key,
      text: o.text,
      behavior: '',
      traitWeights: {},
    }));
  }
  return blankOptions(4);
}
