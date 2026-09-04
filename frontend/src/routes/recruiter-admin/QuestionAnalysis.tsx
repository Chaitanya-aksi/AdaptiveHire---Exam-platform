import { useEffect, useMemo, useState } from 'react';
import { SubNav } from '../../components/SubNav';
import { Link } from 'react-router-dom';
import { modulesApi, questionsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type {
  ItemAnalysis,
  ItemFlag,
  ModuleCatalogEntry,
} from '../../lib/types';

/**
 * How each question is actually performing.
 *
 * The bank already tracked how often every question was used and how often it
 * was answered correctly, and showed neither — which meant a question that
 * scored good candidates *down* was indistinguishable from one that worked.
 * Everything here is derived from answers already given.
 */

/** Ordered worst-first: what the reader should act on comes at the top. */
const FLAG_COPY: Record<
  ItemFlag,
  { label: string; tone: 'bad' | 'warn' | 'info'; detail: string }
> = {
  negative_discrimination: {
    label: 'Scoring backwards',
    tone: 'bad',
    detail:
      'Weaker candidates answer this correctly more often than stronger ones. Almost always a mis-keyed correct answer — check it before anything else here.',
  },
  too_hard: {
    label: 'Almost nobody gets it',
    tone: 'warn',
    detail:
      'So few candidates answer correctly that it may be ambiguous, mis-keyed, or testing something the section never covers.',
  },
  weak_discrimination: {
    label: 'Separates nobody',
    tone: 'warn',
    detail:
      'Strong and weak candidates do about equally well, so this question adds little to the score either way.',
  },
  too_easy: {
    label: 'Almost everybody gets it',
    tone: 'warn',
    detail:
      'Nearly every candidate answers correctly, so it spends a question without telling you much.',
  },
  difficulty_drift: {
    label: 'Difficulty has drifted',
    tone: 'info',
    detail:
      'How candidates actually perform disagrees with the difficulty this was authored at, which pulls the adaptive engine off target.',
  },
  dead_distractor: {
    label: 'Unused wrong answer',
    tone: 'info',
    detail:
      'At least one wrong option is essentially never chosen, so the question is easier in practice than it looks.',
  },
  insufficient_data: {
    label: 'Not enough attempts yet',
    tone: 'info',
    detail:
      'Too few candidates have answered this for the statistics to mean anything. Nothing is being claimed about it.',
  },
};

/**
 * The chip for a question below the threshold.
 *
 * A question nobody has ever been served and one answered nineteen times are
 * both "insufficient data" to the server, and both correctly show dashes — but
 * they are not the same thing to the person reading the page. One is waiting for
 * a few more attempts; the other has never been in front of a candidate, and
 * telling them it lacks *enough* attempts implies some were made.
 */
const shortfall = (item: ItemAnalysis): string =>
  item.attempts === 0
    ? 'Never asked'
    : `${item.attempts} of ${item.attempts + item.attemptsNeeded} attempts`;

const FLAG_ORDER: ItemFlag[] = [
  'negative_discrimination',
  'too_hard',
  'weak_discrimination',
  'too_easy',
  'difficulty_drift',
  'dead_distractor',
  'insufficient_data',
];

/** Worst flag first, so a row's severity is its first flag. */
const severity = (item: ItemAnalysis): number =>
  Math.min(
    ...item.flags.map((flag) => FLAG_ORDER.indexOf(flag)),
    FLAG_ORDER.length,
  );

const percent = (value: number): string => `${Math.round(value * 100)}%`;

function ItemRow({ item }: { item: ItemAnalysis }) {
  const [open, setOpen] = useState(false);
  const worst = item.flags.length > 0 ? FLAG_COPY[item.flags[0]] : null;
  const measured = item.attemptsNeeded === 0;

  return (
    <article className={`ia-item${worst ? ` ia-item--${worst.tone}` : ''}`}>
      <button
        type="button"
        className="ia-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="ia-text">{item.questionText}</span>

        {/*
          Below the threshold the three figures are replaced by one sentence
          rather than shown as "— / — / 0". Three dashes read as broken data;
          they are in fact the correct answer to a question nobody has answered,
          and the row should say which of the two it is.
        */}
        {measured ? (
          <span className="ia-figures">
            <span className="ia-figure">
              <span className="ia-figure-n">
                {item.pValue === null ? '—' : percent(item.pValue)}
              </span>
              <span className="ia-figure-l">Correct</span>
            </span>
            <span className="ia-figure">
              <span
                className={`ia-figure-n${
                  item.discrimination !== null && item.discrimination < 0
                    ? ' ia-negative'
                    : ''
                }`}
              >
                {item.discrimination === null
                  ? '—'
                  : item.discrimination.toFixed(2)}
              </span>
              <span className="ia-figure-l">Separation</span>
            </span>
            <span className="ia-figure">
              <span className="ia-figure-n">{item.attempts}</span>
              <span className="ia-figure-l">Attempts</span>
            </span>
          </span>
        ) : (
          <span className="ia-figures">
            <span className="ia-figure ia-figure--wide">
              <span className="ia-figure-n ia-pending">{shortfall(item)}</span>
              <span className="ia-figure-l">
                {item.attemptsNeeded} more before it is scored
              </span>
            </span>
          </span>
        )}
      </button>

      {/* `insufficient_data` is the *only* flag a question below the threshold
          carries, and the figures beside it already say so — more precisely
          than the chip could, since "not enough attempts yet" is the wrong
          sentence for a question nobody has ever been served. So the chip row
          is for real findings, and this row has none to show. */}
      {measured && item.flags.length > 0 && (
        <div className="ia-flags">
          {item.flags.map((flag) => (
            <span
              key={flag}
              className={`ia-flag ia-flag--${FLAG_COPY[flag].tone}`}
            >
              {FLAG_COPY[flag].label}
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="ia-detail">
          {measured ? (
            item.flags.map((flag) => (
              <p key={flag} className="ia-explain">
                <strong>{FLAG_COPY[flag].label}.</strong>{' '}
                {FLAG_COPY[flag].detail}
              </p>
            ))
          ) : (
            <p className="ia-explain">
              <strong>Nothing measured yet.</strong>{' '}
              {item.attempts === 0
                ? 'No candidate has answered this question, so there is nothing to report about it.'
                : `${item.attempts} ${item.attempts === 1 ? 'candidate has' : 'candidates have'} answered this — too few for a proportion or a correlation to mean anything, so no figures are published.`}{' '}
              Nothing is being claimed about it either way.
            </p>
          )}

          <div className="ia-meta">
            <span>
              Authored difficulty <strong>{item.authoredDifficulty}</strong>
            </span>
            {item.drift !== null && (
              <span>
                Observed{' '}
                <strong>
                  {item.drift > 0 ? '+' : ''}
                  {Math.round(item.drift)}
                </strong>{' '}
                {item.drift > 0 ? 'harder' : 'easier'} than authored
              </span>
            )}
            <span>{item.moduleName}</span>
          </div>

          {/* The options are always worth reading; the pick rates are not
              always worth drawing. Below the threshold every bar is either
              empty or built from a handful of answers, and a chart of near-
              zeroes invites conclusions the numbers cannot carry. */}
          <table className="ia-options">
            <thead>
              <tr>
                <th scope="col">Option</th>
                {measured && <th scope="col">Chosen by</th>}
              </tr>
            </thead>
            <tbody>
              {item.options.map((option) => (
                <tr
                  key={option.key}
                  className={option.isCorrect ? 'ia-option--correct' : ''}
                >
                  <td>
                    <strong>{option.key}</strong> {option.text}
                    {option.isCorrect && (
                      <span className="ia-correct-tag">correct</span>
                    )}
                  </td>
                  {measured && (
                    <td className="ia-rate">
                      <span className="ia-rate-bar">
                        <span style={{ width: `${option.pickRate * 100}%` }} />
                      </span>
                      {percent(option.pickRate)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <Link
            to={`/admin/questions?q=${encodeURIComponent(item.questionId)}`}
          >
            Open in the question bank
          </Link>
        </div>
      )}
    </article>
  );
}

/**
 * The one section, its three views.
 *
 * Performance is not a separate part of the product — it is the same questions
 * with their answer statistics attached, and bulk import is how they arrive.
 * All three used to be top-level nav items.
 */
const QUESTION_TABS = [
  { to: '/admin/questions', label: 'Questions', end: true },
  { to: '/admin/questions/analysis', label: 'Performance' },
  { to: '/admin/import', label: 'Bulk import' },
];

export function QuestionAnalysis() {
  const [items, setItems] = useState<ItemAnalysis[]>([]);
  const [modules, setModules] = useState<ModuleCatalogEntry[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    modulesApi
      .list()
      .then(setModules)
      .catch(() => setModules([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    questionsApi
      .analysis(moduleId || undefined)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(describeError(err, 'Could not load question analysis.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  const shown = useMemo(() => {
    const filtered = onlyFlagged
      ? items.filter(
          (item) =>
            item.flags.length > 0 && !item.flags.includes('insufficient_data'),
        )
      : items;

    // Worst first: this page exists to be acted on, not browsed.
    return [...filtered].sort((a, b) => severity(a) - severity(b));
  }, [items, onlyFlagged]);

  const needingAttention = items.filter(
    (item) => severity(item) <= FLAG_ORDER.indexOf('too_easy'),
  ).length;

  /*
   * How much of the bank has actually been measured.
   *
   * Worth stating outright, because on a young bank the honest answer is
   * "almost none of it" and every row correctly says so — which without this
   * line reads as a page that failed to load rather than one reporting that
   * nobody has answered these questions yet. `threshold` is read off the data
   * rather than hardcoded: the server owns that number.
   */
  const measured = items.filter((item) => item.attemptsNeeded === 0);

  /*
   * Read off a row that is still *below* the threshold, because only there does
   * `attempts + attemptsNeeded` come to the threshold itself. On a row that has
   * met it `attemptsNeeded` is 0 and the sum is that row's own attempt count, so
   * taking the maximum across everything reported the busiest question in the
   * bank as the bar every question has to clear — "until 50 candidates have
   * answered it" once a single question reached fifty.
   *
   * Null when every question has enough, which is the one case the payload
   * cannot answer: no row is left carrying the number. The sentence quoting it
   * is dropped rather than guessed, and it has nothing to explain by then
   * anyway — no row is showing dashes.
   */
  const pending = items.find((item) => item.attemptsNeeded > 0);
  const threshold = pending ? pending.attempts + pending.attemptsNeeded : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Question bank</h1>
          <p>
            How each question behaves in real attempts — whether it separates
            strong candidates from weak ones, and whether its difficulty matches
            what it was authored at.
          </p>
          <SubNav items={QUESTION_TABS} />
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {!loading && items.length > 0 && (
        <div className="card card-pad ia-coverage">
          <strong>
            {measured.length} of {items.length} question
            {items.length === 1 ? '' : 's'}{' '}
            {measured.length === 1 ? 'has' : 'have'} enough attempts to report
            on.
          </strong>{' '}
          {threshold !== null && (
            <span className="muted">
              Nothing is published about a question until {threshold} candidates
              have answered it. Every figure here is a proportion or a
              correlation, and both are noise on a handful of answers — a
              question that looks like it is scoring backwards after five
              attempts usually is not. The rest of this list is waiting, not
              broken.
            </span>
          )}
        </div>
      )}

      <div className="toolbar">
        <select
          value={moduleId}
          onChange={(e) => setModuleId(e.target.value)}
          aria-label="Filter by subject"
        >
          <option value="">All subjects</option>
          {modules.map((module) => (
            <option key={module.id} value={module.id}>
              {module.name}
            </option>
          ))}
        </select>

        <label className="ia-toggle">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
          />
          Only questions needing attention
        </label>

        {!loading && needingAttention > 0 && (
          <span className="badge warn">
            {needingAttention} needing attention
          </span>
        )}
      </div>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="card empty">
          {onlyFlagged
            ? 'Nothing is flagged in this subject.'
            : 'No multiple-choice questions here yet.'}
        </div>
      ) : (
        <div className="ia-list">
          {shown.map((item) => (
            <ItemRow key={item.questionId} item={item} />
          ))}
        </div>
      )}

      <p className="muted small" style={{ marginTop: 18 }}>
        &ldquo;Separation&rdquo; is the correlation between answering a question
        correctly and doing well overall. Above about 0.2 is healthy; near zero
        means the question tells you little; below zero means it is scoring
        strong candidates down. Nothing is reported until a question has enough
        attempts for the figures to mean anything.
      </p>
    </>
  );
}
