import type { ModuleRunState } from '../adaptive-engine/engine.types';

/**
 * Everything about an in-progress attempt that isn't worth a database write.
 * Lives in Redis for the life of the session; `assessment_sessions` is written
 * once at start and once at end, exactly as the locked schema intends.
 *
 * Anything the client could lie about — which question is on screen, how many
 * are answered, how much time is left — is read from here, never from the
 * request.
 */
export interface SessionState {
  sessionId: string;
  candidateId: string;
  invitationId: string;
  assessmentId: string;
  assessmentTitle: string;

  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms. Hard cap on the whole attempt; the auto-submit job fires here. */
  expiresAt: number;

  status: 'in_progress' | 'finished';

  modules: ModuleRunState[];
  currentModuleIndex: number;

  /** The one question the candidate may currently answer. */
  served: ServedQuestion | null;
  /** Answers recorded so far across the whole session, for `sequenceNumber`. */
  answeredTotal: number;
}

export interface ServedQuestion {
  questionId: string;
  moduleId: string;
  /** Epoch ms — used to derive `timeTakenMs` server-side. */
  servedAt: number;
}
