export type UserRole = 'candidate' | 'recruiter_admin';
export type ScoringType = 'objective' | 'trait';
export type QuestionStatus = 'draft' | 'active' | 'archived';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
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
}

export interface Question {
  id: string;
  questionText: string;
  status: QuestionStatus;
  tags: string[];
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
  } | null;
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
 * A question as served to a candidate. Note what is absent: no correct option,
 * no difficulty, no trait weights. The API strips them, and nothing in this
 * app should ever expect them back.
 */
export interface RuntimeQuestion {
  id: string;
  text: string;
  options: { key: string; text: string }[];
}

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
}

export interface ViolationCount {
  eventType: ProctoringEventType;
  count: number;
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
    overallScore: number | null;
    generatedAt: string | null;
  };
  modules: ReportModuleSummary[];
  violations: ViolationCount[];
}

/** Layer two: queried live, never stored on the report. */
export interface ReportDetail {
  sessionId: string;
  answers: {
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
  }[];
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
  hiringRecommendation: HiringRecommendation | null;
  violationCount: number;
}
