import {
  HiringRecommendation,
  ProctoringEventType,
  ScoringType,
  SessionStatus,
} from '../common/enums';
import {
  buildBehavioralProfiles,
  type BehavioralAssessment,
  type ProfileScore,
} from './behavioral-profiles';
import {
  ABILITY_CEILING,
  ABILITY_FLOOR,
  ABILITY_WEIGHT,
  BEHAVIORAL_WEIGHT,
  BORDERLINE_AT,
  CONSISTENT_AT,
  MIN_COVERAGE_RATIO,
  MIN_TRAIT_CONFIDENCE,
  RECOMMENDED_AT,
  STRONGLY_RECOMMENDED_AT,
  STRONG_SCORE,
  VARIED_AT,
  WEAK_SCORE,
} from './report.constants';

/** One trait as the recruiter sees it — label, not engine key, and inverted
 * already where the workplace framing is the opposite pole. */
export interface ReportedTrait {
  key: string;
  label: string;
  /** 0-100 on the reporting scale. */
  score: number;
  confidence: number;
  /**
   * How consistently the candidate expressed this trait across different
   * situations, 0..1. Null when fewer than two answers touched it, and on
   * results stored before consistency was measured.
   */
  consistency: number | null;
}

/** One twinned pair as the recruiter sees it. */
export interface ReportedProbePair {
  /** Position of the first question in the session's answer list. */
  firstSequence: number;
  /** Null when the twin never came round before the module ended. */
  secondSequence: number | null;
  /**
   * 0..1. Null means the pair could not be compared — the twin was never
   * served, or timed out unanswered. Never rendered as zero: not checking is
   * not the same as disagreeing.
   */
  agreement: number | null;
  /** Objective pairs: the right/wrong outcome changed between the twins. */
  flipped: boolean | null;
  /** Trait pairs: the traits the two answers disagreed on, worst first. */
  divergentTraits: {
    key: string;
    label: string;
    first: number;
    second: number;
  }[];
}

/**
 * A module's repeat-probe outcome.
 *
 * Distinct from `ModuleSummary.consistency`, and the two answer different
 * questions. That one asks "how steadily did each trait show up across all the
 * situations we put?"; this one asks "when we put the same situation twice in
 * different words, did the answer hold?". A candidate can score well on one and
 * badly on the other.
 */
export interface ProbeSummary {
  agreement: number | null;
  resolved: number;
  unresolved: number;
  pairs: ReportedProbePair[];
}

export interface ModuleSummary {
  moduleId: string;
  name: string;
  slug: string;
  scoringType: ScoringType;
  /** Objective only: the raw Elo estimate. */
  abilityScore: number | null;
  /** Objective only: `abilityScore` on the 0-100 scale. */
  score: number | null;
  questionsAnswered: number;
  questionsCorrect: number;
  /**
   * Objective only: how many of the questions this module actually served the
   * candidate would be expected to get right by guessing alone — the sum of
   * `1 / options` over them. Null for trait modules, which have no right answer,
   * and null for an objective module whose served questions could not be read.
   *
   * Shown next to `questionsCorrect` so a score is never read without the
   * evidence underneath it. Four-option questions put chance at a quarter, but
   * the bank allows up to six, so this is summed per question rather than
   * assumed — telling a recruiter that 25% is chance when the candidate was
   * served six-option items would understate what they actually did.
   *
   * Deliberately a count and not a verdict. Nothing here corrects the score,
   * caps the recommendation or flags the attempt; it states what the questions
   * were worth so the person reading can weigh it. That is the same division of
   * labour as the proctoring signals.
   */
  expectedByChance: number | null;
  /** What the assessment asked for, so under-answering is visible. */
  questionCount: number;
  traits: ReportedTrait[];
  /** Mean consistency across the traits with enough evidence to measure. */
  consistency: number | null;
  /** Repeat-probe outcome, or null when this module opened no pair. */
  probes: ProbeSummary | null;
  /**
   * True when this result's stored scores use a trait vocabulary the module no
   * longer declares — an attempt sat before the vocabulary changed. Its numbers
   * are real but not comparable with current ones, and the UI says so rather
   * than rendering today's traits at a fabricated neutral 50.
   */
  legacyTraitModel: boolean;
}

export interface ViolationCount {
  eventType: ProctoringEventType;
  count: number;
}

export interface ReportInput {
  candidateName: string;
  assessmentTitle: string;
  sessionStatus: SessionStatus;
  modules: ModuleSummary[];
  violations: ViolationCount[];
}

export interface BuiltReport {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  /**
   * Null when there is no score to band — an attempt with nothing scoreable
   * answered gets no recommendation rather than a middling one.
   */
  hiringRecommendation: HiringRecommendation | null;
  /**
   * The headline figure the recommendation is banded on: ability and the
   * behavioural index blended, or whichever of the two the assessment produced.
   * Null only when the candidate answered nothing scoreable at all.
   */
  overallScore: number | null;
  /** Mean of the objective modules' 0-100 scores. Null when none were sat. */
  abilityScore: number | null;
  /** The behavioural index, 0-100. Null when no composite had enough evidence. */
  behavioralScore: number | null;
  /** The role-relevant composites behind that index. */
  profiles: ProfileScore[];
}

const VIOLATION_LABEL: Record<ProctoringEventType, [string, string]> = {
  [ProctoringEventType.TAB_SWITCH]: ['tab switch', 'tab switches'],
  [ProctoringEventType.FULLSCREEN_EXIT]: [
    'full-screen exit',
    'full-screen exits',
  ],
  [ProctoringEventType.FACE_ABSENT]: [
    'period with no face visible',
    'periods with no face visible',
  ],
  // "Not properly in view", never "looked away". The measurement is where a
  // face sat in the frame, which says nothing about where its eyes went.
  [ProctoringEventType.FACE_NOT_FRAMED]: [
    'period with the face not properly in view',
    'periods with the face not properly in view',
  ],
  [ProctoringEventType.MULTIPLE_FACES]: [
    'sighting of more than one face',
    'sightings of more than one face',
  ],
  // "Period of background noise", never "period of talking". The browser
  // measures a level and discards the samples — it cannot tell a voice from a
  // television, and wording it as speech would put a claim in the report that
  // the measurement does not support.
  [ProctoringEventType.BACKGROUND_NOISE]: [
    'period of background noise',
    'periods of background noise',
  ],
  [ProctoringEventType.MULTIPLE_DISPLAYS_DETECTED]: [
    'multi-display detection',
    'multi-display detections',
  ],
};

/**
 * How many of the questions served the candidate would be expected to answer
 * correctly by guessing alone, given how many options each one carried.
 *
 * Summed as `1 / options` per question rather than assumed from the option
 * floor. `MIN_OPTIONS` is four, so four-option items put chance at a quarter,
 * but the bank allows six — and quoting a quarter to a recruiter whose
 * candidate was served six-option items overstates what guessing was worth.
 *
 * Null when nothing could be read: an objective module that served no MCQ
 * details has no chance level to state, and stating zero would claim that every
 * correct answer was earned.
 */
export function expectedCorrectByChance(optionCounts: number[]): number | null {
  const usable = optionCounts.filter((count) => count > 0);
  if (usable.length === 0) return null;

  const total = usable.reduce((sum, count) => sum + 1 / count, 0);
  return round1(total);
}

/** Elo estimate onto the 0-100 reporting scale, clamped to the bank's range. */
export function normaliseAbility(ability: number): number {
  const span = ABILITY_CEILING - ABILITY_FLOOR;
  const ratio = (ability - ABILITY_FLOOR) / span;
  return round1(Math.min(1, Math.max(0, ratio)) * 100);
}

/**
 * Builds the whole summary layer from already-computed module results. Pure —
 * no database, no clock — so the wording and the thresholds can be tested
 * directly.
 *
 * Proctoring counts appear in the narrative but never move the
 * recommendation. Detect and log for recruiter judgment; the decision stays
 * with a person.
 */
export function buildReport(input: ReportInput): BuiltReport {
  const objective = input.modules.filter(
    (module) => module.scoringType === ScoringType.OBJECTIVE,
  );
  const attempted = objective.filter((module) => module.questionsAnswered > 0);

  const abilityScore =
    attempted.length > 0
      ? round1(
          attempted.reduce((total, module) => total + (module.score ?? 0), 0) /
            attempted.length,
        )
      : null;

  // Composites are built across every trait the session measured, not per
  // module: they are statements about the candidate, and a second trait module
  // would be more evidence for the same composites rather than a second set.
  const behavioral = buildBehavioralProfiles(
    input.modules.flatMap((module) => module.traits),
  );

  const overallScore = blendScores(abilityScore, behavioral.index);
  const coverage = coverageRatio(input.modules);

  return {
    summary: buildNarrative(input, abilityScore, behavioral, coverage),
    strengths: collectStrengths(input.modules, behavioral),
    weaknesses: collectWeaknesses(input.modules, behavioral),
    hiringRecommendation: recommend(overallScore, coverage),
    overallScore,
    abilityScore,
    behavioralScore: behavioral.index,
    profiles: behavioral.profiles,
  };
}

/**
 * Ability and behaviour into one number, `ABILITY_WEIGHT` to
 * `BEHAVIORAL_WEIGHT`.
 *
 * Whichever half is missing drops out and the other takes the full weight —
 * renormalising rather than treating an unmeasured half as a zero, which would
 * halve the score of every candidate who only sat one kind of section.
 */
export function blendScores(
  abilityScore: number | null,
  behavioralScore: number | null,
): number | null {
  const parts: { score: number; weight: number }[] = [];
  if (abilityScore !== null) {
    parts.push({ score: abilityScore, weight: ABILITY_WEIGHT });
  }
  if (behavioralScore !== null) {
    parts.push({ score: behavioralScore, weight: BEHAVIORAL_WEIGHT });
  }
  if (parts.length === 0) return null;

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  return round1(
    parts.reduce((sum, part) => sum + part.score * part.weight, 0) /
      totalWeight,
  );
}

/**
 * The rule, in full: bands on the blended overall score, capped at `borderline`
 * when the candidate answered too little for the score to mean much.
 *
 * That score is ability and the behavioural index at `ABILITY_WEIGHT` to
 * `BEHAVIORAL_WEIGHT`. The behavioural half enters only through the composites
 * — "would they lead this team", "will they follow through" — never as a rating
 * of the personality itself, and no individual trait can move the outcome.
 *
 * Proctoring still feeds in nowhere. Signals are reported for the recruiter to
 * weigh; nothing in this file can auto-disqualify anyone.
 */
function recommend(
  overallScore: number | null,
  coverage: number,
): HiringRecommendation | null {
  // No score, no recommendation. "Borderline" used to stand in here, which was
  // the wrong shape of answer: it is a band — a judgement that the evidence put
  // this candidate in the middle — and there was no evidence. A recruiter
  // scanning a list has no way to tell that "borderline" from one somebody
  // actually earned, and the two mean opposite things about what to do next.
  if (overallScore === null) return null;

  const banded =
    overallScore >= STRONGLY_RECOMMENDED_AT
      ? HiringRecommendation.STRONGLY_RECOMMENDED
      : overallScore >= RECOMMENDED_AT
        ? HiringRecommendation.RECOMMENDED
        : overallScore >= BORDERLINE_AT
          ? HiringRecommendation.BORDERLINE
          : HiringRecommendation.NOT_RECOMMENDED;

  if (coverage >= MIN_COVERAGE_RATIO) return banded;

  // Thin evidence can lower a recommendation but never raise one: a candidate
  // who answered two questions well has not earned "recommended", and one who
  // answered two badly has not earned "not recommended" either.
  return banded === HiringRecommendation.STRONGLY_RECOMMENDED ||
    banded === HiringRecommendation.RECOMMENDED
    ? HiringRecommendation.BORDERLINE
    : banded;
}

/** How much of what the assessment asked for the candidate actually answered. */
function coverageRatio(modules: ModuleSummary[]): number {
  const expected = modules.reduce(
    (total, module) => total + module.questionCount,
    0,
  );
  if (expected === 0) return 1;

  const answered = modules.reduce(
    (total, module) => total + module.questionsAnswered,
    0,
  );
  return Math.min(1, answered / expected);
}

function collectStrengths(
  modules: ModuleSummary[],
  behavioral: BehavioralAssessment,
): string[] {
  const strengths: string[] = [];

  for (const module of modules) {
    if (module.score !== null && module.score >= STRONG_SCORE) {
      strengths.push(`${module.name} — scored ${module.score}/100`);
    }
    for (const trait of confidentTraits(module)) {
      if (trait.score >= STRONG_SCORE) {
        strengths.push(`${trait.label} — ${trait.score}/100`);
      }
    }
  }

  // Composites come after the raw traits: a recruiter scanning the list reads
  // the specific findings first and the capability they add up to second.
  for (const profile of confidentProfiles(behavioral)) {
    if (profile.band === 'strong') {
      strengths.push(`${profile.label} — ${profile.score}/100`);
    }
  }

  return strengths;
}

function collectWeaknesses(
  modules: ModuleSummary[],
  behavioral: BehavioralAssessment,
): string[] {
  const weaknesses: string[] = [];

  for (const module of modules) {
    if (module.score !== null && module.score <= WEAK_SCORE) {
      weaknesses.push(`${module.name} — scored ${module.score}/100`);
    }
    for (const trait of confidentTraits(module)) {
      if (trait.score <= WEAK_SCORE) {
        weaknesses.push(`${trait.label} — ${trait.score}/100`);
      }
    }
    if (
      module.questionsAnswered > 0 &&
      module.questionsAnswered < module.questionCount
    ) {
      weaknesses.push(
        `${module.name} — answered only ${module.questionsAnswered} of the ${module.questionCount} questions this section asks for`,
      );
    }
  }

  for (const profile of confidentProfiles(behavioral)) {
    if (profile.band === 'developing') {
      weaknesses.push(
        `${profile.label} — ${profile.score}/100, the weakest of the behavioural profiles`,
      );
    }
  }

  return weaknesses;
}

/** Composites resting on enough evidence to be called either way. */
function confidentProfiles(behavioral: BehavioralAssessment): ProfileScore[] {
  return behavioral.profiles.filter(
    (profile) => profile.confidence >= MIN_TRAIT_CONFIDENCE,
  );
}

function confidentTraits(module: ModuleSummary): ReportedTrait[] {
  return module.traits.filter(
    (trait) => trait.confidence >= MIN_TRAIT_CONFIDENCE,
  );
}

function buildNarrative(
  input: ReportInput,
  abilityScore: number | null,
  behavioral: BehavioralAssessment,
  coverage: number,
): string {
  const name = input.candidateName || 'The candidate';
  const parts: string[] = [];

  const objective = input.modules.filter(
    (module) =>
      module.scoringType === ScoringType.OBJECTIVE &&
      module.questionsAnswered > 0,
  );
  const answered = input.modules.reduce(
    (total, module) => total + module.questionsAnswered,
    0,
  );

  if (abilityScore === null && behavioral.index === null) {
    parts.push(
      `${name} did not complete any scored section of ${input.assessmentTitle}, so there is no score to report.`,
    );
  } else if (abilityScore === null) {
    // Behavioural-only: the profile is the result, so it leads.
    parts.push(
      `${name} sat ${input.assessmentTitle}, which measures behaviour rather ` +
        `than ability, across ${countOf(answered, 'question')} answered. ` +
        `Their behavioural profile scores ${behavioral.index}/100 overall.`,
    );
  } else {
    parts.push(
      `${name} scored ${abilityScore}/100 on the scored sections of ` +
        `${input.assessmentTitle}, across ` +
        `${countOf(objective.length, 'scored section')} and ` +
        `${countOf(answered, 'question')} answered.`,
    );

    const ranked = [...objective].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0),
    );
    const best = ranked[0];
    const worst = ranked.at(-1);
    if (best && worst && best.moduleId !== worst.moduleId) {
      parts.push(
        `Strongest section was ${best.name} (${best.score}/100); weakest was ${worst.name} (${worst.score}/100).`,
      );
    }
  }

  parts.push(describeProfiles(behavioral, abilityScore !== null));
  parts.push(describeTraits(input.modules));
  parts.push(describeConsistency(input.modules));
  parts.push(describeProbes(input.modules));

  if (input.sessionStatus === SessionStatus.AUTO_SUBMITTED) {
    parts.push(
      'The attempt was submitted automatically when time ran out rather than finished by the candidate.',
    );
  }

  if (coverage < MIN_COVERAGE_RATIO) {
    parts.push(
      'Coverage was low against what the assessment asked for, so this result rests on less evidence than intended — the recommendation is capped accordingly.',
    );
  }

  parts.push(describeViolations(input.violations));

  return parts.filter(Boolean).join(' ');
}

/**
 * The composites in one sentence: the capability the traits add up to, best and
 * weakest.
 *
 * Framed as fit for a kind of work, never as a rating of the person. "Their
 * profile is strongest on Leadership Readiness" says which work the answers
 * point toward; it does not say they are a better person than someone whose
 * profile leans to Collaboration.
 */
function describeProfiles(
  behavioral: BehavioralAssessment,
  hasAbilityScore: boolean,
): string {
  // Narrated only where the composite carries a score. A withheld one has too
  // little behind it to be called a strength or a weakness in prose, which is
  // the same judgement that withheld the number in the first place.
  const profiles = behavioral.profiles.filter(
    (profile): profile is ProfileScore & { score: number } =>
      profile.score !== null && profile.confidence >= MIN_TRAIT_CONFIDENCE,
  );
  if (profiles.length === 0 || behavioral.index === null) return '';

  const ranked = [...profiles].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const worst = ranked.at(-1);

  // The behavioural share of the blend is only worth stating where there is an
  // ability score for it to be a share of.
  const weighting = hasAbilityScore
    ? ` The behavioural profile scores ${behavioral.index}/100 and carries ` +
      `${Math.round(BEHAVIORAL_WEIGHT * 100)}% of the overall score.`
    : '';

  if (!best || !worst || best.key === worst.key) {
    return `Their behavioural profile is strongest on ${best.label} (${best.score}/100).${weighting}`;
  }

  return (
    `Their behavioural profile points strongest to ${best.label} ` +
    `(${best.score}/100) and weakest to ${worst.label} (${worst.score}/100).` +
    weighting
  );
}

function describeTraits(modules: ModuleSummary[]): string {
  const traits = modules
    .flatMap((module) => module.traits)
    .filter((trait) => trait.confidence >= MIN_TRAIT_CONFIDENCE);
  if (traits.length === 0) return '';

  const ranked = [...traits].sort((a, b) => b.score - a.score);
  const highest = ranked[0];
  const lowest = ranked.at(-1);
  if (!highest || !lowest || highest.key === lowest.key) {
    return `On the behavioural profile, ${highest.label} scored ${highest.score}/100.`;
  }

  return (
    `Behaviourally, they scored highest on ${highest.label} (${highest.score}/100) ` +
    `and lowest on ${lowest.label} (${lowest.score}/100).`
  );
}

/**
 * How steady the behavioural answers were across situations.
 *
 * Phrased as a pointer to the evidence, never as a verdict. A candidate who
 * helps a struggling teammate but works alone under their own deadline is not
 * lying — they are behaving differently in two different situations, which is
 * exactly the thing scenario-based questions exist to surface. The recruiter
 * reads the answers and decides what it means.
 */
function describeConsistency(modules: ModuleSummary[]): string {
  const measured = modules
    .map((module) => module.consistency)
    .filter((value): value is number => value !== null);
  if (measured.length === 0) return '';

  const mean = measured.reduce((sum, v) => sum + v, 0) / measured.length;

  if (mean >= CONSISTENT_AT) {
    return 'Their behavioural answers pointed the same way across different situations.';
  }
  if (mean <= VARIED_AT) {
    return (
      'Their behavioural answers varied noticeably from one situation to the ' +
      'next. That is a prompt to read the question-by-question evidence rather ' +
      'than a judgement — people do act differently in different contexts, and ' +
      'it does not affect the recommendation.'
    );
  }
  return 'Their behavioural answers were broadly consistent across situations, with some variation.';
}

/**
 * The repeat probes, stated as what was done and what came back.
 *
 * The mechanism is named explicitly — the candidate met the same question twice,
 * reworded, several questions apart — because a recruiter cannot weigh an
 * agreement figure without knowing how it was obtained. What it means is left to
 * them: a flip on a reasoning pair points at a lucky guess, a flip on a
 * behavioural pair at a preference that is less settled than one answer made it
 * look, and neither is proof of anything on its own.
 */
function describeProbes(modules: ModuleSummary[]): string {
  const pairs = modules
    .flatMap((module) => module.probes?.pairs ?? [])
    .filter((pair) => pair.agreement !== null);
  if (pairs.length === 0) return '';

  const consistent = pairs.filter(
    (pair) => (pair.agreement ?? 0) >= CONSISTENT_AT,
  ).length;

  const preamble =
    `${countOf(pairs.length, 'question')} the candidate answered came back ` +
    'later in the same section, reworded and with reordered options, several ' +
    'questions apart. ';

  if (consistent === pairs.length) {
    return (
      preamble +
      (pairs.length === 1
        ? 'The two answers matched.'
        : 'Every pair of answers matched.')
    );
  }

  if (consistent === 0) {
    return (
      preamble +
      `The second answer differed ${
        pairs.length === 1 ? 'from the first' : 'in every case'
      }. Both answers of each pair are in the detail view — worth reading before ` +
      'drawing a conclusion, since neither of them is necessarily the wrong one.'
    );
  }

  return (
    preamble +
    `${consistent} of ${pairs.length} matched; the rest are flagged in the ` +
    'detail view alongside both answers.'
  );
}

function describeViolations(violations: ViolationCount[]): string {
  const present = violations.filter((violation) => violation.count > 0);
  if (present.length === 0) {
    return 'No proctoring signals were recorded during the attempt.';
  }

  const listed = present
    .map((violation) => {
      const [one, many] = VIOLATION_LABEL[violation.eventType];
      return `${violation.count} ${violation.count === 1 ? one : many}`;
    })
    .join(', ');

  // Never phrased as a verdict — the recruiter reads the timestamped list and
  // decides whether any of it matters.
  return `Proctoring recorded ${listed}. These are signals, not conclusions; the full timestamped list is in the detail view.`;
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
