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
