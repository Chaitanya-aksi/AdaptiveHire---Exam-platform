import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionsApi } from '../lib/endpoints';
import { describeError } from '../lib/errors';
import type { SessionStep } from '../lib/types';

interface UseSession {
  step: SessionStep | null;
  error: string | null;
  /** True while the first step is being fetched — the whole screen is blank. */
  loading: boolean;
  /** True while an answer or a module start is in flight. */
  busy: boolean;
  answer: (questionId: string, option: string) => Promise<void>;
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

  const apply = useCallback((next: SessionStep) => {
    sessionId.current = next.session.sessionId;
    setStep(next);
    setError(null);
  }, []);

  useEffect(() => {
    if (!invitationId) return;
    let cancelled = false;

    sessionsApi
      .start(invitationId)
      .then((next) => {
        if (!cancelled) apply(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(describeError(err, 'Could not start this assessment.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
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
    (questionId: string, option: string) =>
      run(
        (id) => sessionsApi.answer(id, questionId, option),
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
