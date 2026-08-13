import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QuestionPoolPicker } from '../../components/questions/QuestionPoolPicker';
import { useToast } from '../../components/Toast';
import { assessmentsApi, questionsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type { Assessment, Question } from '../../lib/types';

/** Enough to cover the largest module in the bank in one request. */
const PAGE_SIZE = 200;

interface ModuleGroup {
  moduleId: string;
  name: string;
  minQuestions: number;
  maxQuestions: number;
  questions: Question[];
}

/**
 * Choose which questions an assessment may draw from.
 *
 * This narrows the engine's choices; it does not become the paper. The engine
 * still picks question by question on difficulty match and trait coverage, so two
 * candidates sitting the same assessment get different papers of different
 * lengths — the pool just bounds what it may choose from.
 *
 * Selecting nothing is a real, useful state: it means no restriction, and the
 * engine uses the whole visible bank. That is the default for a new assessment,
 * so a recruiter only comes here if they want to narrow it.
 */
export function AssessmentQuestions() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [groups, setGroups] = useState<ModuleGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        const found = await assessmentsApi.get(id);

        // Only active questions can ever be served, so only they are offered —
        // listing drafts here would let someone build a pool that looks big
        // enough and still starves the module.
        const perModule = await Promise.all(
          found.modules.map((config) =>
            questionsApi.list({
              moduleId: config.moduleId,
              status: 'active',
              limit: PAGE_SIZE,
            }),
          ),
        );
        if (cancelled) return;

        setAssessment(found);
        setGroups(
          found.modules.map((config, index) => ({
            moduleId: config.moduleId,
            name: config.module?.name ?? 'Section',
            minQuestions: config.minQuestions,
            maxQuestions: config.maxQuestions,
            questions: perModule[index].items,
          })),
        );
        setSelected(new Set(found.questionPool.map((row) => row.questionId)));
      } catch (err) {
        if (!cancelled) {
          setError(describeError(err, 'Could not load this assessment.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const toggle = useCallback((questionId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }, []);

  const setMany = useCallback((questionIds: string[], include: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const questionId of questionIds) {
        if (include) next.add(questionId);
        else next.delete(questionId);
      }
      return next;
    });
  }, []);

  /**
   * Whether the selection is one the server would reject.
   *
   * Only the count per module is needed here — the picker works out and shows
   * what is wrong with it, so duplicating that reasoning would just be two
   * places to keep in step.
   */
  const curating = selected.size > 0;
  const blocked = useMemo(
    () =>
      curating &&
      groups.some(
        (group) =>
          group.questions.filter((q) => selected.has(q.id)).length <
          group.minQuestions,
      ),
    [curating, groups, selected],
  );

  const save = async () => {
    if (!id || blocked) return;
    setSaving(true);
    setError(null);

    try {
      const saved = await assessmentsApi.setQuestionPool(id, [...selected]);
      setAssessment(saved);
      toast.success(
        saved.questionPool.length === 0
          ? 'Pool cleared — the engine will use every question you can see.'
          : `Pool saved: ${saved.questionPool.length} questions.`,
      );
    } catch (err) {
      setError(describeError(err, 'Could not save the question pool.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="empty">Loading questions…</div>;
  if (error && !assessment) return <div className="alert error">{error}</div>;
  if (!assessment) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Questions for {assessment.title}</h1>
          <p>
            Tick the questions the adaptive engine may draw from. It still chooses
            question by question on how the candidate is doing — this only bounds
            what it may choose.
          </p>
        </div>
        <Link to="/admin/assessments">Back to assessments</Link>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        {curating ? (
          <>
            <strong>{selected.size} questions selected.</strong> The engine will
            draw only on these.
          </>
        ) : (
          <>
            <strong>Nothing selected — no restriction.</strong> The engine will
            draw on every question your organisation can see, which is the
            default. Tick questions below to narrow it.
          </>
        )}
      </div>

      <div className="stack">
        {groups.map((group) => (
          <QuestionPoolPicker
            key={group.moduleId}
            name={group.name}
            questions={group.questions}
            selected={selected}
            minQuestions={group.minQuestions}
            maxQuestions={group.maxQuestions}
            onToggle={toggle}
            onSetMany={setMany}
          />
        ))}
      </div>

      <div className="assess-actions" style={{ marginTop: 16 }}>
        <span className="muted small">
          {blocked
            ? 'Every section needs at least its minimum, or clear the whole selection for no restriction.'
            : 'Saved changes apply to attempts started from now on.'}
        </span>
        <button
          className="primary"
          type="button"
          disabled={saving || blocked}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save pool'}
        </button>
      </div>
    </>
  );
}
