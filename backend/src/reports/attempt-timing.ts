import { SessionStatus } from '../common/enums';

/*
 * How long an attempt took.
 *
 * There are two honest answers to "how long did they take", and a recruiter
 * judging a candidate needs both:
 *
 *  - **Elapsed** is wall clock from the moment they started to the moment it
 *    was submitted. It is what a recruiter means by "how long were they at it",
 *    and it includes reading the instructions, thinking between questions, and
 *    walking away from the desk.
 *  - **Time on questions** is the sum of the per-question timers. It excludes
 *    everything between questions, so it is the closest thing to effort spent
 *    answering.
 *
 * Reporting only the first would make a candidate who took a phone call look
 * slow; reporting only the second would hide someone who spent an hour on a
 * twenty-minute test. They are labelled separately in the UI for that reason,
 * never summed and never averaged together.
 */

export interface AttemptTiming {
  startedAt: string;
  /** Null while the attempt is still running. */
  submittedAt: string | null;
  /**
   * Wall clock, start to submit. Null while in progress — a running total would
   * be stale the moment it was serialised, and the report is not a live view.
   */
  elapsedSeconds: number | null;
  /**
   * Sum of the per-question timers, where the caller has the answers to hand.
   *
   * Null rather than 0 when they do not: the cohort list would need every
   * response row for every attempt to compute it, which is a lot of rows to
   * load for a column most readers scroll past. 0 would be a lie — it would
   * read as "answered instantly" rather than "not measured here".
   */
  timeOnQuestionsSeconds: number | null;
  /**
   * True when the deadline submitted it rather than the candidate.
   *
   * Worth flagging beside the duration, because for an auto-submitted attempt
   * the elapsed time is just the assessment's own time limit — it says what the
   * clock allowed, not what the candidate chose to spend.
   */
  autoSubmitted: boolean;
}

/** The session fields this needs; kept structural so callers can pass an entity. */
interface TimedSession {
  status: SessionStatus;
  startedAt: Date;
  submittedAt: Date | null;
}

export function attemptTiming(
  session: TimedSession,
  /** Per-question times in ms, where available. Omit on list views. */
  timeTakenMs?: (number | null)[],
): AttemptTiming {
  const elapsedSeconds = session.submittedAt
    ? Math.max(
        0,
        Math.round(
          (session.submittedAt.getTime() - session.startedAt.getTime()) / 1000,
        ),
      )
    : null;

  return {
    startedAt: session.startedAt.toISOString(),
    submittedAt: session.submittedAt?.toISOString() ?? null,
    elapsedSeconds,
    timeOnQuestionsSeconds: timeTakenMs
      ? Math.round(
          // Typed accumulator: the array is `(number | null)[]`, so without it
          // the running total is inferred as nullable too.
          timeTakenMs.reduce<number>((total, ms) => total + (ms ?? 0), 0) /
            1000,
        )
      : null,
    autoSubmitted: session.status === SessionStatus.AUTO_SUBMITTED,
  };
}

/** "1h 04m" / "18m 32s" / "45s" — the same shape the candidate's page uses. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}
