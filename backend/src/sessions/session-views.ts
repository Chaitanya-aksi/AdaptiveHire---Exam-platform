import type { ScoringType, SessionStatus } from '../common/enums';
import type { ModuleRunStatus } from '../adaptive-engine/engine.types';

/** One option as the candidate sees it — never carries the correct answer. */
export interface QuestionOptionView {
  key: string;
  text: string;
}

export interface QuestionView {
  id: string;
  text: string;
  options: QuestionOptionView[];
}

export interface ModuleView {
  moduleId: string;
  name: string;
  slug: string;
  scoringType: ScoringType;
  status: ModuleRunStatus;
  description: string | null;
  minQuestions: number;
  maxQuestions: number;
  timeLimitSeconds: number;
  answered: number;
}

export interface SessionView {
  sessionId: string;
  assessmentId: string;
  assessmentTitle: string;
  status: SessionStatus;
  startedAt: string;
  expiresAt: string;
  /** Server-computed; the client renders this, it never computes its own. */
  sessionRemainingMs: number;
  modules: ModuleView[];
  currentModuleIndex: number;
}

/**
 * What the candidate runtime gets back from every step call. One shape for
 * "next question", "submit answer" and "resume", so the client has a single
 * state machine to drive the screen.
 */
export type SessionStep =
  | {
      state: 'module_intro';
      session: SessionView;
      module: ModuleView;
    }
  | {
      state: 'question';
      session: SessionView;
      module: ModuleView;
      question: QuestionView;
      /** 1-based position within the whole session. */
      sequenceNumber: number;
      /** Answered so far in this module, and the configured bounds. */
      moduleProgress: { answered: number; min: number; max: number };
      moduleRemainingMs: number;
    }
  | {
      state: 'completed';
      session: SessionView;
    };
