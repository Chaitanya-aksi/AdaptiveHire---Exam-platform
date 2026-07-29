import {
  HiringRecommendation,
  ProctoringEventType,
  ScoringType,
  SessionStatus,
} from '../common/enums';
import {
  ABILITY_CEILING,
  ABILITY_FLOOR,
  BORDERLINE_AT,
  MIN_COVERAGE_RATIO,
  MIN_TRAIT_CONFIDENCE,
  RECOMMENDED_AT,
  STRONGLY_RECOMMENDED_AT,
  STRONG_SCORE,
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
  /** What the assessment asked for, so under-answering is visible. */
  minQuestions: number;
  traits: ReportedTrait[];
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
  hiringRecommendation: HiringRecommendation;
  overallScore: number | null;
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
  [ProctoringEventType.MULTIPLE_FACES]: [
    'sighting of more than one face',
    'sightings of more than one face',
  ],
  [ProctoringEventType.MULTIPLE_DISPLAYS_DETECTED]: [
    'multi-display detection',
    'multi-display detections',
  ],
};

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

  const overallScore =
    attempted.length > 0
      ? round1(
          attempted.reduce((total, module) => total + (module.score ?? 0), 0) /
            attempted.length,
        )
      : null;

  const strengths = collectStrengths(input.modules);
  const weaknesses = collectWeaknesses(input.modules);
  const coverage = coverageRatio(input.modules);

  return {
    summary: buildNarrative(input, overallScore, coverage),
    strengths,
    weaknesses,
    hiringRecommendation: recommend(overallScore, coverage),
    overallScore,
  };
}

/**
 * The rule, in full: bands on the overall objective score, capped at
 * `borderline` when the candidate answered too little for the score to mean
 * much. Nothing else feeds in — not traits (there is no "good" personality),
 * and not proctoring.
 */
function recommend(
  overallScore: number | null,
  coverage: number,
): HiringRecommendation {
  if (overallScore === null) return HiringRecommendation.BORDERLINE;

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
    (total, module) => total + module.minQuestions,
    0,
  );
  if (expected === 0) return 1;

  const answered = modules.reduce(
    (total, module) => total + module.questionsAnswered,
    0,
  );
  return Math.min(1, answered / expected);
}

function collectStrengths(modules: ModuleSummary[]): string[] {
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

  return strengths;
}

function collectWeaknesses(modules: ModuleSummary[]): string[] {
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
      module.questionsAnswered < module.minQuestions
    ) {
      weaknesses.push(
        `${module.name} — answered only ${module.questionsAnswered} of the ${module.minQuestions} questions this section asks for`,
      );
    }
  }

  return weaknesses;
}

function confidentTraits(module: ModuleSummary): ReportedTrait[] {
  return module.traits.filter(
    (trait) => trait.confidence >= MIN_TRAIT_CONFIDENCE,
  );
}

function buildNarrative(
  input: ReportInput,
  overallScore: number | null,
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

  if (overallScore === null) {
    parts.push(
      `${name} did not complete any scored section of ${input.assessmentTitle}, so there is no ability score to report.`,
    );
  } else {
    parts.push(
      `${name} scored ${overallScore}/100 overall on ${input.assessmentTitle}, ` +
        `across ${countOf(objective.length, 'scored section')} and ` +
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

  parts.push(describeTraits(input.modules));

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
