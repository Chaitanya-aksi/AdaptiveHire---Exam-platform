import { useEffect, useState } from 'react';
import { SubNav } from '../../components/SubNav';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/Modal';
import { QuestionEditor } from '../../components/questions/QuestionEditor';
import { useToast } from '../../components/Toast';
import { modulesApi, questionsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type {
  BehavioralPattern,
  ModuleCatalogEntry,
  Paginated,
  Question,
  QuestionStatus,
} from '../../lib/types';

const PAGE_SIZE = 15;

/** Short badge text; the full description lives in the editor's picker. */
const PATTERN_BADGE: Record<BehavioralPattern, string> = {
  situational: 'situational',
  forced_choice: 'forced choice',
  trade_off: 'trade-off',
  ranking: 'ranking',
};

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

export function Questions() {
  const toast = useToast();
  const [modules, setModules] = useState<ModuleCatalogEntry[]>([]);
  const [data, setData] = useState<Paginated<Question> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // The question queued for permanent deletion, and whether the call is
  // in flight — drives the confirmation modal.
  const [pendingDelete, setPendingDelete] = useState<Question | null>(null);
  const [deleting, setDeleting] = useState(false);

  // null = closed. { question: null } = creating; { question } = editing.
  const [editor, setEditor] = useState<{ question: Question | null } | null>(
    null,
  );

  /*
   * Subject and status live in the query string rather than in local state, so
   * the dashboard can link straight to a filtered view ("?moduleId=…&status=
   * draft"), and so back/forward and a copied URL both reproduce what the user
   * was looking at. Search and page stay local — they change too often to be
   * worth a history entry.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const moduleId = searchParams.get('moduleId') ?? '';
  const status = (searchParams.get('status') as QuestionStatus | null) ?? '';

  const setFilter = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    void modulesApi.list().then(setModules);
  }, []);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    questionsApi
      .list({
        moduleId: moduleId || undefined,
        status: status || undefined,
        search: debouncedSearch || undefined,
        page,
        limit: PAGE_SIZE,
      })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err, 'Could not load questions.'));
        // Clear the loading row — otherwise the table sits on "Loading…"
        // underneath the error banner forever.
        setData({ items: [], total: 0, page: 1, limit: PAGE_SIZE });
      });

    return () => {
      cancelled = true;
    };
  }, [moduleId, status, debouncedSearch, page]);

  const refresh = () => setPage((p) => p);

  const setQuestionStatus = async (
    question: Question,
    action: 'activate' | 'archive',
  ) => {
    try {
      const updated =
        action === 'activate'
          ? await questionsApi.activate(question.id)
          : await questionsApi.archive(question.id);

      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((q) =>
                q.id === updated.id ? { ...q, status: updated.status } : q,
              ),
            }
          : current,
      );
      toast.success(
        action === 'activate' ? 'Question activated.' : 'Question archived.',
      );
    } catch (err) {
      const message = describeError(err, `Could not ${action} that question.`);
      setError(message);
      toast.error(message);
      refresh();
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    try {
      await questionsApi.remove(target.id);
      setData((current) =>
        current
          ? {
              ...current,
              total: Math.max(0, current.total - 1),
              items: current.items.filter((q) => q.id !== target.id),
            }
          : current,
      );
      toast.success('Question deleted.');
      setPendingDelete(null);
    } catch (err) {
      // 409 = the question has been answered and can only be archived. Surface
      // the backend's explanation and keep the dialog open so the recruiter can
      // read it before deciding.
      toast.error(describeError(err, 'Could not delete that question.'));
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const onSaved = (saved: Question, created: boolean, editedId?: string) => {
    setEditor(null);

    // Editing a platform question does not change it — it creates this
    // organisation's own copy, which comes back with a different id. Splicing by
    // the saved id alone would match nothing and the row would look unchanged
    // until a refresh, so the row is matched on the id that was *edited*.
    const forked = editedId !== undefined && editedId !== saved.id;
    toast.success(
      created
        ? 'Question created.'
        : forked
          ? 'Saved as your own copy. Other organisations keep the original.'
          : 'Question saved.',
    );

    // Refetch rather than splice the row in: a new question may not belong on
    // the current page or match the active filters.
    if (created) setPage(1);
    else
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((q) =>
                q.id === (editedId ?? saved.id) ? saved : q,
              ),
            }
          : current,
      );
  };

  if (editor) {
    return (
      <QuestionEditor
        modules={modules}
        question={editor.question}
        onSaved={onSaved}
        onCancel={() => setEditor(null)}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Question bank</h1>
          <p>Every question the adaptive engine can draw from.</p>
          <SubNav items={QUESTION_TABS} />
        </div>
        <button
          className="primary"
          disabled={modules.length === 0}
          onClick={() => setEditor({ question: null })}
        >
          New question
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <div className="toolbar">
          <input
            className="search"
            placeholder="Search question text…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={moduleId}
            onChange={(e) => setFilter({ moduleId: e.target.value })}
          >
            <option value="">All subjects</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setFilter({ status: e.target.value })}
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
          {(moduleId || status) && (
            <button
              className="link"
              onClick={() => setFilter({ moduleId: '', status: '' })}
            >
              Clear filters
            </button>
          )}
          <span className="muted small">
            {data
              ? `${data.total} question${data.total === 1 ? '' : 's'}`
              : '…'}
          </span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: '46%' }}>Question</th>
                <th>Subject</th>
                <th>Difficulty</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data === null && (
                <tr>
                  <td colSpan={5} className="empty">
                    Loading…
                  </td>
                </tr>
              )}

              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No questions match those filters.
                  </td>
                </tr>
              )}

              {data?.items.map((q) => (
                <tr key={q.id}>
                  <td>
                    <button
                      className="link"
                      onClick={() =>
                        setExpanded(expanded === q.id ? null : q.id)
                      }
                      style={{ textAlign: 'left' }}
                    >
                      {q.questionText}
                    </button>

                    {expanded === q.id && (
                      <div style={{ marginTop: 8 }}>
                        {q.mcqDetails && (
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {q.mcqDetails.options.map((o) => (
                              <li
                                key={o.key}
                                style={{
                                  color:
                                    o.key === q.mcqDetails?.correctOption
                                      ? 'var(--success)'
                                      : undefined,
                                  fontWeight:
                                    o.key === q.mcqDetails?.correctOption
                                      ? 600
                                      : undefined,
                                }}
                              >
                                {o.key}. {o.text}
                                {o.key === q.mcqDetails?.correctOption && ' ✓'}
                              </li>
                            ))}
                          </ul>
                        )}

                        {q.personalityDetails && (
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {q.personalityDetails.options.map((o) => (
                              <li key={o.key}>
                                {o.key}. {o.text}{' '}
                                {o.behavior && (
                                  <span className="badge">{o.behavior}</span>
                                )}{' '}
                                <span className="muted mono">
                                  {Object.entries(o.traitWeights)
                                    .map(
                                      ([t, w]) =>
                                        `${t}: ${w > 0 ? '+' : ''}${w}`,
                                    )
                                    .join(', ')}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {q.tags.length > 0 && (
                          <div className="row" style={{ marginTop: 8 }}>
                            {q.tags.map((t) => (
                              <span key={t} className="badge">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {q.module?.name ?? '—'}
                    {/* Which behavioural shape this is — legacy Likert items
                        predate the patterns and are served only rarely. */}
                    {q.personalityDetails && (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge">
                          {q.personalityDetails.pattern
                            ? PATTERN_BADGE[q.personalityDetails.pattern]
                            : 'legacy'}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="mono">
                    {q.mcqDetails ? q.mcqDetails.difficultyScore : '—'}
                  </td>
                  <td>
                    <span className={`badge ${q.status}`}>{q.status}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="link"
                        onClick={() => setEditor({ question: q })}
                      >
                        Edit
                      </button>
                      {q.status !== 'active' && (
                        <button
                          className="link"
                          onClick={() => void setQuestionStatus(q, 'activate')}
                        >
                          Activate
                        </button>
                      )}
                      {q.status !== 'archived' && (
                        <button
                          className="link"
                          onClick={() => void setQuestionStatus(q, 'archive')}
                        >
                          Archive
                        </button>
                      )}
                      <button
                        className="link danger-link"
                        onClick={() => setPendingDelete(q)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          className="toolbar spread"
          style={{ borderTop: '1px solid var(--border)', borderBottom: 0 }}
        >
          <span className="muted small">
            Page {data?.page ?? 1} of {totalPages}
          </span>
          <div className="row">
            <button
              disabled={!data || data.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              disabled={!data || data.page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        busy={deleting}
        title="Delete this question?"
        confirmLabel="Delete permanently"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        message={
          <div className="stack" style={{ gap: 10 }}>
            <p style={{ margin: 0 }}>
              This permanently removes the question and its options. This
              can&rsquo;t be undone.
            </p>
            {pendingDelete && (
              <blockquote className="quote">
                {pendingDelete.questionText}
              </blockquote>
            )}
            <p className="muted small" style={{ margin: 0 }}>
              A question that a candidate has already answered can&rsquo;t be
              deleted — archive it instead to preserve their results.
            </p>
          </div>
        }
      />
    </>
  );
}
