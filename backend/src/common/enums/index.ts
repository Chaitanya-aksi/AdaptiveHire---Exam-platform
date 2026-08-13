export enum UserRole {
  CANDIDATE = 'candidate',
  RECRUITER_ADMIN = 'recruiter_admin',
}

/**
 * How a module's questions are scored.
 * `objective` — right/wrong, Elo-updated ability estimate.
 * `trait`     — personality-style, per-option trait weights.
 * New subjects are added as rows in `modules`, not as new code.
 */
export enum ScoringType {
  OBJECTIVE = 'objective',
  TRAIT = 'trait',
}

export enum QuestionStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

/**
 * How a behavioural question is put to the candidate.
 *
 * All four live inside the single Personality module — they are presentation
 * and scoring shapes, not separate subjects. None of them has a correct
 * answer; each option carries trait weights instead.
 *
 * A question with a null pattern is a legacy agree/disagree Likert item, the
 * format this engine exists to move away from. Those stay servable but rare.
 */
export enum BehavioralPattern {
  /** Workplace scenario, one choice. */
  SITUATIONAL = 'situational',
  /** Two equally positive alternatives — measures preference, not quality. */
  FORCED_CHOICE = 'forced_choice',
  /** Two competing priorities, e.g. speed against thoroughness. */
  TRADE_OFF = 'trade_off',
  /** Every option ordered, most like you first. Position changes the weight. */
  RANKING = 'ranking',
}

export enum InvitationStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

export enum SessionStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  AUTO_SUBMITTED = 'auto_submitted',
  ABANDONED = 'abandoned',
}

export enum ModuleStopReason {
  CONFIDENCE_REACHED = 'confidence_reached',
  MAX_QUESTIONS = 'max_questions',
  TIME_EXPIRED = 'time_expired',
  POOL_EXHAUSTED = 'pool_exhausted',
}

export enum ProctoringEventType {
  TAB_SWITCH = 'tab_switch',
  FULLSCREEN_EXIT = 'fullscreen_exit',
  FACE_ABSENT = 'face_absent',
  MULTIPLE_FACES = 'multiple_faces',
  MULTIPLE_DISPLAYS_DETECTED = 'multiple_displays_detected',
}

/**
 * Rule-based only. Proctoring signals are surfaced as data alongside this —
 * they never auto-disqualify a candidate.
 */
export enum HiringRecommendation {
  STRONGLY_RECOMMENDED = 'strongly_recommended',
  RECOMMENDED = 'recommended',
  BORDERLINE = 'borderline',
  NOT_RECOMMENDED = 'not_recommended',
}
