export enum UserRole {
  CANDIDATE = 'candidate',
  RECRUITER_ADMIN = 'recruiter_admin',
}

/**
 * What someone may do *inside* their organisation.
 *
 * Deliberately a second axis rather than more values on `UserRole`. That enum
 * answers "which side of the platform is this" — it drives portal separation,
 * the route guards, and which JavaScript bundle a browser is allowed to fetch.
 * Folding four workspace roles into it would mean every one of them had to be
 * listed on every `@Roles(UserRole.RECRUITER_ADMIN)` in the codebase, and a
 * single omission would lock a whole role out of a page with no obvious cause.
 *
 * So `role` stays the audience and `orgRole` is the permission. Candidates
 * belong to no organisation and have `orgRole` null, permanently.
 *
 * Ordered least to most privileged; `ORG_ROLE_RANK` below depends on it.
 */
export enum OrgRole {
  /** Reads everything the organisation can see. Changes nothing. */
  VIEWER = 'viewer',
  /**
   * Runs their own requisitions: creates assessments and invites candidates,
   * and sees results for the assessments they own rather than the whole
   * workspace's.
   */
  HIRING_MANAGER = 'hiring_manager',
  /** The whole workspace, including the question bank and other people. */
  ADMIN = 'admin',
  /** An Admin who can also hand the workspace to somebody else. */
  OWNER = 'owner',
}

/**
 * Privilege order, so a check can say "Admin or above" instead of listing the
 * roles above Admin and going stale the moment another is added.
 */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  [OrgRole.VIEWER]: 0,
  [OrgRole.HIRING_MANAGER]: 1,
  [OrgRole.ADMIN]: 2,
  [OrgRole.OWNER]: 3,
};

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
  /**
   * A face is visible but not properly in shot — off to one side, too far
   * away, or pressed against the lens.
   *
   * Distinct from `FACE_ABSENT`, and the distinction is the point. Counting
   * faces was the whole check until 2026-08-20, which meant a camera angled at
   * the ceiling with the candidate's head in one corner logged nothing: a face
   * was present, so everything looked fine. This is what that case reports
   * now, and it is named for what was measured — calling an occupied chair
   * "absent" would put a claim in a candidate's report the measurement does
   * not support. `metadata.reason` says which way it failed.
   */
  FACE_NOT_FRAMED = 'face_not_framed',
  MULTIPLE_DISPLAYS_DETECTED = 'multiple_displays_detected',
  /**
   * Sustained sound above a threshold while a module was running.
   *
   * Named for what is actually measured. The browser reads a level from an
   * `AnalyserNode` and throws the samples away — nothing is recorded, buffered
   * or transmitted — so this cannot tell a voice from a television, a sibling
   * from a lawnmower, and must never be labelled "talking" in the UI.
   *
   * A soft signal like the displays one: the recruiter weighs it. A candidate
   * sitting a test in a noisy house has done nothing wrong.
   */
  BACKGROUND_NOISE = 'background_noise',
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
