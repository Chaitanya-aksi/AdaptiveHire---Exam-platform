import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionsApi } from '../lib/endpoints';
import { describeError } from '../lib/errors';
import type { AnswerPayload, SessionStep } from '../lib/types';

interface UseSession {
  step: SessionStep | null;
  error: string | null;
  /** True while the first step is being fetched — the whole screen is blank. */
  loading: boolean;
  /** True while an answer or a module start is in flight. */
  busy: boolean;
  answer: (questionId: string, payload: AnswerPayload) => Promise<void>;
  startModule: () => Promise<void>;
  /** Re-asks the server where we are. Used when a clock runs out. */
  refresh: () => Promise<void>;
}

/**
 * Owns the candidate's run. Every server reply replaces the whole step, so the
 * screen is always exactly what the backend says it should be — there is no
 * local model of "which question is next" to drift out of sync or be nudged
 * from the console.
 */
export function useSession(invitationId: string | undefined): UseSession {
  const [step, setStep] = useState<SessionStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Survives re-renders so refresh() works after the first step arrives.
  const sessionId = useRef<string | null>(null);

  // Which invitation we have already asked the server to start. React's
  // development double-mount runs this effect twice, and two starts for one
  // invitation race each other server-side; the backend now resolves that race,
  // but there is no reason to make the request twice.
  const startedFor = useRef<string | null>(null);

  const apply = useCallback((next: SessionStep) => {
    sessionId.current = next.session.sessionId;
    setStep(next);
    setError(null);
  }, []);

  useEffect(() => {
    if (!invitationId) return;
    // No cleanup flag to ignore the reply: the guard already means this request
    // is made exactly once, so there is no second reply to discard — and
    // discarding this one would leave the screen loading forever.
    if (startedFor.current === invitationId) return;
    startedFor.current = invitationId;

    sessionsApi
      .start(invitationId)
      .then(apply)
      .catch((err) => {
        // Let the candidate try again rather than stranding them on the error.
        startedFor.current = null;
        setError(describeError(err, 'Could not start this assessment.'));
      })
      .finally(() => setLoading(false));
  }, [invitationId, apply]);

  /** Shared wrapper: one in-flight call at a time, errors surfaced not thrown. */
  const run = useCallback(
    async (
      call: (id: string) => Promise<SessionStep>,
      fallback: string,
    ): Promise<void> => {
      const id = sessionId.current;
      if (!id) return;

      setBusy(true);
      try {
        apply(await call(id));
      } catch (err) {
        setError(describeError(err, fallback));
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const answer = useCallback(
    (questionId: string, payload: AnswerPayload) =>
      run(
        (id) => sessionsApi.answer(id, questionId, payload),
        'Could not save that answer.',
      ),
    [run],
  );

  const startModule = useCallback(
    () => run((id) => sessionsApi.startModule(id), 'Could not start this section.'),
    [run],
  );

  const refresh = useCallback(
    () => run((id) => sessionsApi.current(id), 'Could not reach the assessment.'),
    [run],
  );

  return { step, error, loading, busy, answer, startModule, refresh };
}
