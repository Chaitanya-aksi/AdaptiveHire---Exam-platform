export type UserRole = 'candidate' | 'recruiter_admin';
export type ScoringType = 'objective' | 'trait';
export type QuestionStatus = 'draft' | 'active' | 'archived';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  /**
   * The company a recruiter works for; null for candidates.
   *
   * Useful for cache keys and for showing whose workspace you are in. It is not
   * a permission — the server reads the real scope from the database on every
   * request and never trusts what the client holds.
   */
  organisationId: string | null;
}

/**
 * Which sign-in page a login came from.
 *
 * Sent so the server can keep each door to its own audience — a recruiter
 * signing in on the candidate form is pointed at their own page rather than let
 * through. The check has to be server-side: refusing on the client would still
 * leave the refresh cookie set, and the next reload would restore the session.
 */
export type LoginPortal = 'candidate' | 'recruiter';

/** Which side of the platform is signing up. */
export type RegistrationType = 'candidate' | 'recruiter';

/**
 * What the register form sends.
 *
 * Candidates are invite-only, so their signup only succeeds for an email a
 * recruiter has already invited. Recruiters are open, and registering creates
 * their company workspace — hence the required `organisationName`.
 */
export interface RegisterPayload {
  fullName: string;
  email: string;
  password: string;
  accountType: RegistrationType;
  /** Required when `accountType` is 'recruiter', ignored otherwise. */
  organisationName?: string;
}

/** The full "my account" view returned by GET /users/me. */
export interface UserProfile extends AuthUser {
  isActive: boolean;
  createdAt: string;
}

/**
 * Response to a recruiter creating an account. `temporaryPassword` is the only
 * time the plaintext exists outside the new user's head — the server keeps a
 * hash, so it cannot be shown again.
 */
export interface CreatedUser {
  user: UserProfile;
  temporaryPassword: string;
}

export interface TraitDefinition {
  key: string;
  label: string;
  invertForReport?: boolean;
}

export interface ModuleCatalogEntry {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  scoringType: ScoringType;
  traits: TraitDefinition[] | null;
  isActive: boolean;
}

export interface McqOption {
  key: string;
  text: string;
}

export interface PersonalityOption {
  key: string;
  text: string;
  traitWeights: Record<string, number>;
  /** Optional label for the tendency this option expresses. Never scored. */
  behavior?: string;
}

export interface Question {
  id: string;
  questionText: string;
  status: QuestionStatus;
  tags: string[];
  /**
   * Twins this question with the others in the same group, so the engine can
   * serve one, wait out the gap, then serve the other and compare the answers.
   * Null on the great majority of questions, which stand on their own.
   */
  probeGroup: string | null;
  /**
   * Null for a platform question — part of the shared starter bank, usable by
   * every organisation and editable by none. Otherwise the organisation that
   * authored it (or forked it from a platform question).
   */
  organisationId: string | null;
  moduleId: string;
  module?: ModuleCatalogEntry;
  createdAt: string;
  mcqDetails: {
    options: McqOption[];
    correctOption: string;
    difficultyScore: number;
    timesUsed: number;
    timesCorrect: number;
  } | null;
  personalityDetails: {
    options: PersonalityOption[];
    timesUsed: number;
    /** Null on legacy agree/disagree items authored before the four patterns. */
    pattern: BehavioralPattern | null;
  } | null;
}

/**
 * What the question form sends. `moduleId` is create-only — moving a question
 * between modules could switch its scoring type and orphan its detail row, so
 * the API refuses it on update.
 */
export interface QuestionDraft {
  questionText: string;
  status?: QuestionStatus;
  tags?: string[];
  /** Empty string clears an existing pairing; omitted leaves it untouched. */
  probeGroup?: string;
  mcq?: {
    options: McqOption[];
    correctOption: string;
    difficultyScore?: number;
  };
  personality?: {
    pattern?: BehavioralPattern;
    options: PersonalityOption[];
  };
}

export interface ModuleQuestionStats {
  moduleId: string;
  name: string;
  slug: string;
  scoringType: ScoringType;
  total: number;
  active: number;
  draft: number;
  archived: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface BulkImportResult {
  totalRows: number;
  imported: number;
  failed: number;
  importedAs: QuestionStatus;
  failures: { row: number; reason: string; questionText?: string }[];
}

export type InvitationStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'expired'
  | 'revoked';

export interface AssessmentModuleConfig {
  id: string;
  moduleId: string;
  minQuestions: number;
  maxQuestions: number;
  timeLimitSeconds: number;
  displayOrder: number;
  module?: ModuleCatalogEntry;
}

export interface Assessment {
  id: string;
  title: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  modules: AssessmentModuleConfig[];
  /**
   * The questions the engine may draw from.
   *
   * **Empty means no restriction** — the engine uses every question the
   * organisation can see. It does not mean "no questions". Curating is opt-in.
   */
  questionPool: { assessmentId: string; questionId: string }[];
}

/** Result of a candidate spreadsheet upload. */
export interface BulkInviteResult {
  totalRows: number;
  invited: number;
  skipped: number;
  failed: number;
  failures: { row: number; email?: string; reason: string }[];
}

/** An invitation as the recruiter sees it, for one assessment. */
export interface AssessmentInvitation {
  id: string;
  email: string;
  status: InvitationStatus;
  registered: boolean;
  candidateName: string | null;
  createdAt: string;
}

/** An invitation as the candidate sees it, in their own list. */
export interface CandidateInvitation {
  id: string;
  status: InvitationStatus;
  createdAt: string;
  assessment: { id: string; title: string; description: string | null };
}

/* ── Test-taking runtime ─────────────────────────────────────────────────── */

export type SessionStatus =
  | 'in_progress'
  | 'completed'
  | 'auto_submitted'
  | 'abandoned';

export type ModuleRunStatus = 'pending' | 'in_progress' | 'completed';

/**
 * Which behavioural shape a Personality question takes. Null on every
 * objective question and on legacy agree/disagree items — both of which render
 * as a plain single choice.
 */
export type BehavioralPattern =
  | 'situational'
  | 'forced_choice'
  | 'trade_off'
  | 'ranking';

/**
 * A question as served to a candidate. Note what is absent: no correct option,
 * no difficulty, no trait weights. The API strips them, and nothing in this
 * app should ever expect them back.
 */
export interface RuntimeQuestion {
  id: string;
  text: string;
  options: { key: string; text: string }[];
  /** Drives which interaction is rendered; only `ranking` changes the payload. */
  pattern: BehavioralPattern | null;
}

/**
 * What the candidate submits. A ranking sends its whole ordering; everything
 * else sends one key. The server rejects the wrong shape for the question it
 * served, so these are never interchangeable.
 */
export type AnswerPayload =
  | { selectedOption: string }
  | { selectedOptions: string[] };

export interface RuntimeModule {
  moduleId: string;
  name: string;
  slug: string;
  description: string | null;
  scoringType: ScoringType;
  status: ModuleRunStatus;
  minQuestions: number;
  maxQuestions: number;
  timeLimitSeconds: number;
  answered: number;
}

export interface RuntimeSession {
  sessionId: string;
  assessmentId: string;
  assessmentTitle: string;
  status: SessionStatus;
  startedAt: string;
  expiresAt: string;
  sessionRemainingMs: number;
  modules: RuntimeModule[];
  currentModuleIndex: number;
}

/**
 * Every runtime call returns one of these three, so the screen is driven by a
 * single server-owned state machine rather than local guesswork.
 */
export type SessionStep =
  | { state: 'module_intro'; session: RuntimeSession; module: RuntimeModule }
  | {
      state: 'question';
      session: RuntimeSession;
      module: RuntimeModule;
      question: RuntimeQuestion;
      sequenceNumber: number;
      moduleProgress: { answered: number; min: number; max: number };
      moduleRemainingMs: number;
    }
  | { state: 'completed'; session: RuntimeSession };

/* ── Reports (recruiter-only) ────────────────────────────────────────────── */

export type HiringRecommendation =
  | 'strongly_recommended'
  | 'recommended'
  | 'borderline'
  | 'not_recommended';

export type ProctoringEventType =
  | 'tab_switch'
  | 'fullscreen_exit'
  | 'face_absent'
  | 'multiple_faces'
  | 'multiple_displays_detected';

export interface ReportedTrait {
  key: string;
  /** Recruiter-facing label, already inverted where the framing demands it. */
  label: string;
  score: number;
  confidence: number;
  /** 0..1, or null when fewer than two answers touched this trait. */
  consistency: number | null;
}

/** One twinned pair of questions, as the recruiter sees it. */
export interface ReportedProbePair {
  firstSequence: number;
  /** Null when the twin never came round before the section ended. */
  secondSequence: number | null;
  /**
   * 0..1. Null means the pair could not be compared — never render it as zero,
   * because not checking is not the same as disagreeing.
   */
  agreement: number | null;
  /** Objective sections: the right/wrong outcome changed between the twins. */
  flipped: boolean | null;
  /** Trait sections: the traits the two answers disagreed on, worst first. */
  divergentTraits: {
    key: string;
    label: string;
    first: number;
    second: number;
  }[];
}

/**
 * A section's repeat-probe outcome.
 *
 * Answers a different question from `ReportModuleSummary.consistency`: that one
 * is "how steadily did each trait show up across all the situations?", this one
 * is "when the same situation came back reworded, did the answer hold?".
 */
export interface ProbeSummary {
  agreement: number | null;
  resolved: number;
  unresolved: number;
  pairs: ReportedProbePair[];
}

export interface ReportModuleSummary {
  moduleId: string;
  name: string;
  slug: string;
  scoringType: ScoringType;
  /** Raw Elo estimate — objective modules only. */
  abilityScore: number | null;
  /** `abilityScore` on the 0-100 reporting scale. */
  score: number | null;
  questionsAnswered: number;
  questionsCorrect: number;
  minQuestions: number;
  traits: ReportedTrait[];
  /** Mean consistency across the traits with enough evidence. */
  consistency: number | null;
  /** Repeat-probe outcome, or null when this section opened no pair. */
  probes: ProbeSummary | null;
  /**
   * This attempt was scored against a trait vocabulary the module has since
   * replaced. Its numbers are real but not comparable with current ones.
   */
  legacyTraitModel: boolean;
}

export interface ViolationCount {
  eventType: ProctoringEventType;
  count: number;
}

/** How a behavioural composite reads at a glance. Wording, never a pass/fail. */
export type ProfileBand = 'strong' | 'moderate' | 'developing';

/**
 * A role-relevant composite derived from the workplace traits — "would they
 * lead this team", not "is this a good personality".
 */
export interface ProfileScore {
  key: string;
  label: string;
  description: string;
  score: number;
  /** 0..1 — the weighted evidence behind the traits that make it up. */
  confidence: number;
  band: ProfileBand;
  /** Which traits fed it and their renormalised shares, largest first. */
  contributions: {
    key: string;
    label: string;
    score: number;
    weight: number;
  }[];
}

/** Layer one: the stored summary. */
export interface ReportSummary {
  sessionId: string;
  status: SessionStatus;
  startedAt: string;
  submittedAt: string | null;
  assessment: { id: string; title: string };
  candidate: { id: string; fullName: string; email: string };
  report: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    hiringRecommendation: HiringRecommendation;
    /** The blended headline figure the recommendation was banded on. */
    overallScore: number | null;
    /** Its ability half, or null when the assessment had no scored section. */
    abilityScore: number | null;
    /** Its behavioural half, or null when no composite had enough evidence. */
    behavioralScore: number | null;
    generatedAt: string | null;
  };
  modules: ReportModuleSummary[];
  /** The composites behind `behavioralScore`. Empty when no traits were sat. */
  profiles: ProfileScore[];
  violations: ViolationCount[];
}

/** What one answer contributed to one trait — the working behind a score. */
export interface TraitContribution {
  key: string;
  label: string;
  /** On the -3..+3 authoring scale, position-weighted for a ranking. */
  weight: number;
}

export interface AnswerDetail {
  sequenceNumber: number;
  moduleName: string;
  questionText: string;
  selectedOption: string | null;
  selectedOptionText: string | null;
  correctOption: string | null;
  isCorrect: boolean | null;
  difficultyAtServe: number | null;
  abilityAfter: number | null;
  timeTakenMs: number | null;
  answeredAt: string;
  /** Behavioural questions only. */
  pattern: BehavioralPattern | null;
  /** Categorical label on the chosen option, where one was authored. */
  behavior: string | null;
  /** Ranking answers only: the ordering, strongest preference first. */
  ranking: { key: string; text: string; behavior: string | null }[] | null;
  /**
   * Set on both halves of a repeat probe and pointing at the other half, so the
   * two rows can be read as one measurement. Null on every other answer.
   */
  probe: ProbeAnswerLink | null;
  traitContributions: TraitContribution[];
}

/** Links one answer to the other half of its repeat probe. */
export interface ProbeAnswerLink {
  /** Whether this row is the original or the reworded twin. */
  role: 'first' | 'twin';
  /** Sequence number of the other half, or null if the twin never came round. */
  partnerSequence: number | null;
  /** How far apart the two were asked, in answered questions. */
  gap: number | null;
  agreement: number | null;
  flipped: boolean | null;
}

/** Layer two: queried live, never stored on the report. */
export interface ReportDetail {
  sessionId: string;
  answers: AnswerDetail[];
  events: {
    eventType: ProctoringEventType;
    occurredAt: string;
    metadata: Record<string, unknown> | null;
  }[];
}

export interface AttemptListItem {
  sessionId: string;
  candidate: { id: string; fullName: string; email: string };
  status: SessionStatus;
  startedAt: string;
  submittedAt: string | null;
  questionsAnswered: number;
  overallScore: number | null;
  /** The two halves behind it, so a blended figure is never unexplained. */
  abilityScore: number | null;
  behavioralScore: number | null;
  hiringRecommendation: HiringRecommendation | null;
  violationCount: number;
}
