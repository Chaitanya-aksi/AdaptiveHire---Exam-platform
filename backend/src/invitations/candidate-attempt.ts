import type { InvitationWindowView } from '../assessments/assessment-window';
import { InvitationStatus, SessionStatus } from '../common/enums';
import type { Branding } from '../organisations/organisations.service';

/**
 * What one candidate is shown about their own attempt.
 *
 * The hard rule for everything in this file: **participation, never
 * performance.** Counts, clocks and timestamps only — no question text, no
 * chosen options, no right/wrong, no ability or trait score, and no stop
 * reason. Two separate things force that line:
 *
 *  - A candidate who can re-read the questions they were served after
 *    submitting can transcribe the bank at leisure and pass it on. During the
 *    test they are at least on a clock and under proctoring.
 *  - `stopReason`, difficulty and the ability estimate describe how the engine
 *    works. The recruiter bundle is code-split away from the candidate one for
 *    exactly that reason (see the comment in `App.tsx`), and it would be
 *    pointless to split the screens and then serve the mechanics over the API.
 *
 * Anything added here later has to clear both.
 */

/** The stages of the status bar, in the order they are drawn. */
export type AttemptStageKey =
  'invited' | 'started' | 'submitted' | 'under_review';

export type AttemptStageState =
  /** Reached, and behind them. */
  | 'done'
  /** Where they are now — the one the bar highlights. */
  | 'current'
  /** Still ahead. */
  | 'upcoming'
  /** Unreachable: the invitation expired or was withdrawn before this point. */
  | 'stopped';

export interface AttemptStage {
  key: AttemptStageKey;
  label: string;
  /** One line of plain language about what this stage means for them. */
  note: string;
  /** When it happened, or null if it has not. */
  at: string | null;
  state: AttemptStageState;
}

/** One section of the assessment, as the candidate sat it. */
export interface AttemptSection {
  moduleId: string;
  name: string;
  questionsAnswered: number;
  /** Sum of the per-question times. Not wall-clock: reading time is not here. */
  timeOnQuestionsSeconds: number;
  startedAt: string | null;
  completedAt: string | null;
}

/** One question's worth of timing — the pace chart, with no question in it. */
export interface AttemptPaceEntry {
  sequenceNumber: number;
  moduleName: string;
  /** Null when the recorded time was missing, which older rows may be. */
  seconds: number | null;
  /** False when the clock ran out on this one before an answer was chosen. */
  answered: boolean;
}

export interface CandidateAttempt {
  status: SessionStatus;
  startedAt: string;
  submittedAt: string | null;
  questionsAnswered: number;
  /** Across every section. */
  timeOnQuestionsSeconds: number;
  /** Rounded, and null rather than 0 when nothing was answered. */
  averageSecondsPerQuestion: number | null;
  sections: AttemptSection[];
  pace: AttemptPaceEntry[];
}

export interface CandidateAttemptView {
  invitation: {
    id: string;
    status: InvitationStatus;
    invitedAt: string;
  };
  /**
   * When they may sit it. Resolved on the server so this page and the runtime
   * cannot disagree — offering a Start button the runtime then refuses is the
   * failure `assessment-window.ts` exists to prevent.
   */
  window: InvitationWindowView;
  /**
   * The company assessing them, and how it presents itself.
   *
   * Per invitation, not per viewer: a candidate belongs to no organisation and
   * may hold invitations from several, so this page is branded by whoever sent
   * *this* one. That includes `supportEmail` — an interrupted attempt is only
   * the inviting company's to re-run, so writing to anyone else is a dead end.
   *
   * The shared `Branding` type rather than a structural copy, so a field added
   * to one candidate-facing surface cannot go missing from the other.
   */
  organisation: Branding;
  assessment: {
    id: string;
    title: string;
    description: string | null;
    sections: { name: string; timeLimitSeconds: number }[];
    totalTimeSeconds: number;
  };
  stages: AttemptStage[];
  /** Null until they begin: there is no attempt yet to describe. */
  attempt: CandidateAttempt | null;
}

const STAGE_COPY: Record<AttemptStageKey, { label: string; note: string }> = {
  invited: {
    label: 'Invited',
    note: 'A recruiting team added you to this assessment.',
  },
  started: {
    label: 'Started',
    note: 'You opened the assessment and began the first section.',
  },
  submitted: {
    label: 'Submitted',
    note: 'Your answers were recorded and the attempt was closed.',
  },
  under_review: {
    label: 'With the recruiting team',
    note: 'Your attempt is ready for the recruiting team to review.',
  },
};

interface StageInput {
  invitationStatus: InvitationStatus;
  invitedAt: Date;
  startedAt: Date | null;
  submittedAt: Date | null;
  /** When the recruiting team's copy of the attempt became available. */
  reviewReadyAt: Date | null;
}

/**
 * Builds the four-stage status bar.
 *
 * Kept as a pure function so the sequencing is testable and so the copy above
 * is the only place any of these words are written.
 */
export function buildStages(input: StageInput): AttemptStage[] {
  const { invitationStatus, invitedAt, startedAt, submittedAt, reviewReadyAt } =
    input;

  // Withdrawn or lapsed: the stages already reached still stand — they really
  // happened — but nothing further will, and saying "upcoming" would promise
  // a step that is never coming.
  const halted =
    submittedAt === null &&
    (invitationStatus === InvitationStatus.REVOKED ||
      invitationStatus === InvitationStatus.EXPIRED);

  const reachedAt: Record<AttemptStageKey, Date | null> = {
    invited: invitedAt,
    started: startedAt,
    submitted: submittedAt,
    under_review: reviewReadyAt,
  };

  const order: AttemptStageKey[] = [
    'invited',
    'started',
    'submitted',
    'under_review',
  ];

  // The furthest stage actually reached is the one the bar highlights; the rest
  // are ahead of it.
  const lastReached = order.reduce(
    (furthest, key, index) => (reachedAt[key] ? index : furthest),
    0,
  );

  return order.map((key, index) => {
    const at = reachedAt[key];

    const state: AttemptStageState =
      at !== null
        ? index === lastReached
          ? 'current'
          : 'done'
        : halted
          ? 'stopped'
          : 'upcoming';

    return {
      key,
      label: STAGE_COPY[key].label,
      note: STAGE_COPY[key].note,
      at: at ? at.toISOString() : null,
      state,
    };
  });
}
