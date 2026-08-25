export type UserRole = 'candidate' | 'recruiter_admin';

/**
 * What a recruiter may do inside their workspace.
 *
 * A second axis to `UserRole`, which says which side of the platform they
 * are on. Null for every candidate. Useful for hiding controls that would
 * be refused — never for deciding access, which only the server does.
 */
export type OrgRole = 'viewer' | 'hiring_manager' | 'admin' | 'owner';
export type ScoringType = 'objective' | 'trait';
export type QuestionStatus = 'draft' | 'active' | 'archived';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  /**
   * True while the account is still using the password AdaptiveHire generated
   * and emailed when a recruiter invited them. They must choose their own
   * before they can reach an assessment.
   */
  mustChangePassword: boolean;
  /**
   * The company a recruiter works for; null for candidates.
   *
   * Useful for cache keys and for showing whose workspace you are in. It is not
   * a permission — the server reads the real scope from the database on every
   * request and never trusts what the client holds.
   */
  organisationId: string | null;
  /** What they may do inside it; null for candidates. */
  orgRole: OrgRole | null;
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

/** What deleting a person destroyed, reported back so the UI can say so. */
export interface DeletionResult {
  /**
   * Whether the login row itself went. False only for a candidate another
   * company has also invited — deleting it would take their records too.
   */
  accountDeleted: boolean;
  /** Attempts wiped, and with them every answer, report and proctoring log. */
  sessions: number;
  /** Invitations withdrawn. */
  invitations: number;
}

/** What deleting an assessment destroyed. */
export interface AssessmentDeletionResult {
  sessions: number;
  invitations: number;
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
  'pending' | 'in_progress' | 'completed' | 'expired' | 'revoked';

export interface AssessmentModuleConfig {
  id: string;
  moduleId: string;
  /** Exactly how many questions this section asks. */
  questionCount: number;
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
  /**
   * The round's own window. Null on either end means no bound, so an
   * assessment with neither is always open — which is the default and what
   * every assessment created before windows existed still is.
   *
   * A single candidate can be moved off this without disturbing it, via the
   * per-invitation override. See `InvitationWindow`.
   */
  opensAt: string | null;
  closesAt: string | null;
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

export type WindowState =
  /** Sittable now. */
  | 'open'
  /** Scheduled, but not yet. */
  | 'not_yet'
  /** The window has passed. */
  | 'closed';

/**
 * When one candidate may sit, as resolved by the server.
 *
 * `state` is not recomputed here — the browser clock is not the one enforcing
 * the window, and a page that decides for itself is how a candidate ends up
 * looking at a Start button the runtime refuses.
 */
export interface InvitationWindow {
  /** The per-invitation override, null where it inherits the assessment's. */
  overrideOpensAt: string | null;
  overrideExpiresAt: string | null;
  /** What actually applies, after the override is layered over the round. */
  opensAt: string | null;
  closesAt: string | null;
  state: WindowState;
}

/** An invitation as the recruiter sees it, for one assessment. */
export interface AssessmentInvitation {
  id: string;
  email: string;
  status: InvitationStatus;
  registered: boolean;
  candidateName: string | null;
  createdAt: string;
  /** Null only if the server could not resolve it; treat as unknown, not open. */
  window: InvitationWindow | null;
}

/**
 * How a company presents itself to the candidates it assesses.
 *
 * Carried per invitation, never per viewer: a candidate belongs to no
 * organisation and may be assessed by several at once, so the portal cannot
 * be branded to "their" company — there is no such thing.
 */
export interface Branding {
  name: string;
  logoUrl: string | null;
  /** `#rrggbb`, or null to use AdaptiveHire's own accent. */
  accentColor: string | null;
  /**
   * Where to write when an assessment goes wrong — already resolved by the
   * server to the company's own address, the platform fallback, or null.
   *
   * Null means show no contact route at all. Do not substitute a placeholder:
   * the person reading it has just lost an attempt to something outside their
   * control, and an address nobody answers is worse than none.
   */
  supportEmail: string | null;
}

/**
 * The same workspace as its own members see it — `Branding` plus the two
 * identifiers a candidate is never shown.
 */
export interface OrganisationProfile extends Branding {
  id: string;
  slug: string;
}

/**
 * A branding change. Every field optional and nullable, and the two mean
 * different things: omitted leaves the value alone, `null` clears it back to
 * AdaptiveHire's own. Without that distinction there would be no way to remove
 * a logo without also resetting the colour.
 */
export interface BrandingPatch {
  logoUrl?: string | null;
  accentColor?: string | null;
  supportEmail?: string | null;
}

/** An invitation as the candidate sees it, in their own list. */
export interface CandidateInvitation {
  id: string;
  status: InvitationStatus;
  createdAt: string;
  assessment: {
    id: string;
    title: string;
    description: string | null;
    /** Subject names in the order they will be sat. */
    modules: string[];
    /**
     * Sum of the per-module limits. An upper bound, not a promise — a module
     * that stops early gives the rest of its clock back.
     */
    totalTimeSeconds: number;
  };
  organisation: Branding;
  /** Whether they may start now, and when if not. */
  window: InvitationWindow;
}

/* ── Item analysis ───────────────────────────────────────────────────────── */

/** What's wrong with a question, if anything. */
export type ItemFlag =
  | 'insufficient_data'
  | 'too_easy'
  | 'too_hard'
  | 'weak_discrimination'
  | 'negative_discrimination'
  | 'dead_distractor'
  | 'difficulty_drift';

export interface ItemOptionStat {
  key: string;
  text: string;
  isCorrect: boolean;
  /** Share of attempts that chose this option, 0-1. */
  pickRate: number;
}

export interface ItemAnalysis {
  questionId: string;
  questionText: string;
  moduleName: string;
  status: QuestionStatus;
  authoredDifficulty: number;
  attempts: number;
  /** Proportion answered correctly — difficulty as observed, 0-1. */
  pValue: number | null;
  /**
   * Point-biserial correlation between answering this correctly and overall
   * ability on the attempt, -1 to 1. Negative means weak candidates do better
   * than strong ones, which is almost always a mis-keyed answer.
   */
  discrimination: number | null;
  /** Observed difficulty minus authored. Positive = harder than it claims. */
  drift: number | null;
  options: ItemOptionStat[];
  flags: ItemFlag[];
}

/* ── The candidate's view of their own attempt ───────────────────────────── */

/**
 * Everything below is **participation, never performance** — counts, clocks and
 * timestamps. The API deliberately serves no question text, no chosen option,
 * no right/wrong and no score to a candidate; see `candidate-attempt.ts` on the
 * backend for why. Do not add a field here that the API does not already send.
 */
export type AttemptStageKey =
  'invited' | 'started' | 'submitted' | 'under_review';

/** `stopped` means the invitation lapsed or was withdrawn before this stage. */
export type AttemptStageState = 'done' | 'current' | 'upcoming' | 'stopped';

export interface AttemptStage {
  key: AttemptStageKey;
  label: string;
  note: string;
  at: string | null;
  state: AttemptStageState;
}

export interface AttemptSection {
  moduleId: string;
  name: string;
  questionsAnswered: number;
  /** Sum of the per-question times — not wall-clock. */
  timeOnQuestionsSeconds: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AttemptPaceEntry {
  sequenceNumber: number;
  moduleName: string;
  seconds: number | null;
  /** False when the clock ran out before an answer was chosen. */
  answered: boolean;
}

export interface CandidateAttempt {
  status: SessionStatus;
  startedAt: string;
  submittedAt: string | null;
  questionsAnswered: number;
  timeOnQuestionsSeconds: number;
  /** Null rather than 0 when nothing was answered. */
  averageSecondsPerQuestion: number | null;
  sections: AttemptSection[];
  pace: AttemptPaceEntry[];
}

export interface CandidateAttemptView {
  invitation: { id: string; status: InvitationStatus; invitedAt: string };
  /** The company assessing them — this page is branded by whoever sent it. */
  organisation: Branding;
  /** When they may sit it. Resolved by the server, never recomputed here. */
  window: InvitationWindow;
  assessment: {
    id: string;
    title: string;
    description: string | null;
    sections: { name: string; timeLimitSeconds: number }[];
    totalTimeSeconds: number;
  };
  stages: AttemptStage[];
  /** Null until they begin — there is no attempt yet to describe. */
  attempt: CandidateAttempt | null;
}

/* ── Test-taking runtime ─────────────────────────────────────────────────── */

export type SessionStatus =
  'in_progress' | 'completed' | 'auto_submitted' | 'abandoned';

export type ModuleRunStatus = 'pending' | 'in_progress' | 'completed';

/**
 * Which behavioural shape a Personality question takes. Null on every
 * objective question and on legacy agree/disagree items — both of which render
 * as a plain single choice.
 */
export type BehavioralPattern =
  'situational' | 'forced_choice' | 'trade_off' | 'ranking';

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
  { selectedOption: string } | { selectedOptions: string[] };

export interface RuntimeModule {
  moduleId: string;
  name: string;
  slug: string;
  description: string | null;
  scoringType: ScoringType;
  status: ModuleRunStatus;
  /** Exactly how many questions this section asks. */
  questionCount: number;
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
      moduleProgress: { answered: number; questionCount: number };
      moduleRemainingMs: number;
    }
  | { state: 'completed'; session: RuntimeSession };

/* ── Reports (recruiter-only) ────────────────────────────────────────────── */

export type HiringRecommendation =
  'strongly_recommended' | 'recommended' | 'borderline' | 'not_recommended';

export type ProctoringEventType =
  | 'tab_switch'
  | 'fullscreen_exit'
  | 'face_absent'
  /**
   * A face is visible but not properly in shot — off to one side, too far
   * away, or pressed against the lens.
   *
   * Distinct from `face_absent`. Face presence used to be a head-count, so a
   * camera angled at the ceiling with the candidate in one corner logged
   * nothing at all; this is what that case reports now. Named for what was
   * measured — an occupied chair reported as an empty one would be a false
   * claim in somebody's hiring record.
   */
  | 'face_not_framed'
  | 'multiple_faces'
  | 'multiple_displays_detected'
  /**
   * Sustained sound above a threshold while a module was running.
   *
   * The level is measured in the browser and the samples discarded — nothing is
   * recorded or transmitted — so this cannot tell a voice from a television.
   * Label it for what it measures; "talking" would be a claim the measurement
   * cannot support, in a document that decides whether somebody gets a job.
   */
  | 'background_noise';

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
  questionCount: number;
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
  /**
   * 0-100, or **null when the evidence behind it is too thin to report**.
   *
   * Withheld by the server rather than caveated: a number on screen gets
   * acted on whatever sits beside it. Render "not enough answers", never a 0.
   */
  score: number | null;
  /** 0..1 — the weighted evidence behind the traits that make it up. */
  confidence: number;
  /** Null whenever `score` is. */
  band: ProfileBand | null;
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
  /** Both clocks, and whether the deadline ended it. */
  timing: AttemptTiming;
  assessment: { id: string; title: string };
  candidate: { id: string; fullName: string; email: string };
  report: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    /**
     * Null when the attempt produced no score to band.
     *
     * Not "borderline". That band is a finding — the evidence put them in the
     * middle — and an attempt with no evidence has not produced one. Render
     * "no result", never a band.
     */
    hiringRecommendation: HiringRecommendation | null;
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

/**
 * A practice question, shown before the assessment and never in it.
 *
 * Comes from a question flagged `isSample`, which the adaptive selector and the
 * assessment pools both refuse — which is why it is safe for `correctOption` to
 * be here at all. Nothing on this object can be asked for real afterwards.
 */
export interface PracticeQuestion {
  id: string;
  /** The subject it previews. */
  moduleName: string;
  scoringType: ScoringType;
  text: string;
  options: { key: string; text: string }[];
  /** Drives the same renderer the real test uses. Null means single-choice. */
  pattern: BehavioralPattern | null;
  /**
   * Null for every trait question — not "unknown" but *there isn't one*, which
   * is the single most useful thing practice can teach about a personality
   * section.
   */
  correctOption: string | null;
}

/** What a recruiting team decided about an attempt. */
export type ReviewDecision = 'shortlisted' | 'rejected';

/**
 * Shared by the whole organisation, not private to one recruiter — a note is
 * meant to be read by colleagues, and `updatedBy` says who wrote it last.
 */
export interface AttemptReview {
  decision: ReviewDecision | null;
  tags: string[];
  note: string | null;
  /** Null once that account is gone; the decision outlives the person. */
  updatedBy: string | null;
  updatedAt: string;
  /**
   * When the candidate was told they were not taken forward, or null.
   *
   * Read-only from the client's side: it is set by the send endpoint, and the
   * server refuses a second send whatever the UI does with this.
   */
  rejectionEmailSentAt: string | null;
}

/**
 * One message the team sent to a candidate.
 *
 * Not the same thing as a review `note`. A note is internal and never leaves
 * the workspace; this was written to be read by the candidate and has been.
 * They live apart so neither can turn into the other by accident.
 */
export interface CandidateMessage {
  id: string;
  body: string;
  /** The address it went to, as it was at send time. */
  sentTo: string;
  /** Null once that account is gone; the record outlives the sender. */
  sentBy: string | null;
  sentAt: string;
}

/**
 * How long an attempt took.
 *
 * Two clocks, never combined. `elapsedSeconds` is wall time from start to
 * submit, which includes thinking and walking away; `timeOnQuestionsSeconds`
 * sums the per-question timers, which is closer to effort spent answering.
 * A recruiter asking "how long did they take" is owed both.
 */
export interface AttemptTiming {
  startedAt: string;
  submittedAt: string | null;
  /** Null while the attempt is still running. */
  elapsedSeconds: number | null;
  /** Null on list views, where the per-question rows are not loaded. */
  timeOnQuestionsSeconds: number | null;
  /** The deadline submitted it, so the duration is just the time limit. */
  autoSubmitted: boolean;
}

/** A partial update. Omitted fields are left alone; `null` clears. */
export interface ReviewPatch {
  decision?: ReviewDecision | null;
  tags?: string[];
  note?: string | null;
}

export interface AttemptListItem {
  sessionId: string;
  candidate: { id: string; fullName: string; email: string };
  status: SessionStatus;
  startedAt: string;
  submittedAt: string | null;
  /** `timeOnQuestionsSeconds` is null here — see the note on the type. */
  timing: AttemptTiming;
  questionsAnswered: number;
  overallScore: number | null;
  /** The two halves behind it, so a blended figure is never unexplained. */
  abilityScore: number | null;
  behavioralScore: number | null;
  /**
   * Position among the scored attempts at this assessment — 1 is the highest
   * overall score. Ties share a position (1, 2, 2, 4).
   *
   * Null when the attempt has no score yet, which is not the same as coming
   * last and must never render as a number.
   */
  rank: number | null;
  /** Scored attempts in the cohort, so `rank` reads as "2nd of 14". */
  cohortSize: number;
  hiringRecommendation: HiringRecommendation | null;
  violationCount: number;
  /** Null until somebody on the team has acted on this attempt. */
  review: AttemptReview | null;
}
