import {
  BEHAVIORAL_MODERATE_AT,
  BEHAVIORAL_STRONG_AT,
  MIN_TRAIT_CONFIDENCE,
} from './report.constants';
import type { ReportedTrait } from './report-builder';

/**
 * Role-relevant composites derived from the workplace traits.
 *
 * A personality module on its own produces ten trait scores and no answer to
 * the question a recruiter actually has, which is never "how agreeable is this
 * person" but "would they lead this team" or "will they follow through". These
 * composites are that answer: each one blends the traits that bear on a single
 * workplace capability.
 *
 * Two things they are deliberately not:
 *
 *   - A personality score. There is no good or bad personality, and nothing
 *     here rates one. A composite says "the traits that bear on leading a team
 *     scored here", which is a statement about fit for a kind of work.
 *   - Learned. Every weight below is authored, fixed, and readable. A recruiter
 *     can add up the traits by hand and get the same number, which is the whole
 *     point of a rule-based report.
 */
export interface ProfileDefinition {
  key: string;
  label: string;
  /** What this composite is for, shown next to the score. */
  description: string;
  /** trait key -> share of the composite. Must sum to 1. */
  weights: Record<string, number>;
}

/**
 * The five composites, weighted over the ten workplace traits.
 *
 * Weights are authored on the principle that each composite has one or two
 * traits that define it and a tail that modulates it — Leadership is mostly
 * leadership and ownership, with communication and accountability shaping how
 * it lands. Every set sums to 1 so a composite is always on the same 0-100
 * scale as the traits feeding it.
 */
export const BEHAVIORAL_PROFILES: ProfileDefinition[] = [
  {
    key: 'leadership_readiness',
    label: 'Leadership Readiness',
    description:
      'Takes charge of a situation, sets direction and carries others with them.',
    weights: {
      leadership: 0.35,
      ownership: 0.2,
      communication: 0.2,
      accountability: 0.15,
      risk_tolerance: 0.1,
    },
  },
  {
    key: 'collaboration',
    label: 'Team Collaboration',
    description: 'Works with and through other people rather than around them.',
    weights: {
      teamwork: 0.35,
      empathy: 0.3,
      communication: 0.25,
      integrity: 0.1,
    },
  },
  {
    key: 'reliability',
    label: 'Reliability & Follow-Through',
    description: 'Owns commitments and closes them out without being chased.',
    weights: {
      accountability: 0.35,
      ownership: 0.3,
      integrity: 0.25,
      resilience: 0.1,
    },
  },
  {
    key: 'resilience_under_pressure',
    label: 'Adaptability Under Pressure',
    description:
      'Holds up and re-plans when the situation changes or the pressure rises.',
    weights: {
      adaptability: 0.4,
      resilience: 0.35,
      risk_tolerance: 0.15,
      ownership: 0.1,
    },
  },
  {
    key: 'integrity_judgment',
    label: 'Integrity & Judgment',
    description:
      'Makes the defensible call when the convenient one is available.',
    weights: {
      integrity: 0.5,
      accountability: 0.25,
      ownership: 0.15,
      empathy: 0.1,
    },
  },
];

/** How a composite reads at a glance. Wording, never a pass/fail. */
export type ProfileBand = 'strong' | 'moderate' | 'developing';

export interface ProfileScore {
  key: string;
  label: string;
  description: string;
  /**
   * 0-100, the weighted mean of the traits that make it up — or **null when
   * the evidence behind it is below `MIN_TRAIT_CONFIDENCE`**.
   *
   * Withheld rather than shown with a caveat: a number on screen gets acted on
   * whatever sits next to it. Three answers spread across ten traits produces
   * arithmetic that is perfectly correct and means nothing, and rendering
   * "50.8 — Moderate" beside a grey line about low confidence invites exactly
   * the reading the caveat was meant to prevent.
   *
   * `contributions` still carries the working, so a recruiter who wants to see
   * what little was measured can.
   */
  score: number | null;
  /**
   * Evidence behind it, 0..1 — the weighted mean of its traits' confidences.
   * Always reported, including when it is what caused `score` to be withheld.
   */
  confidence: number;
  /** Null whenever `score` is: an unreportable composite has no band either. */
  band: ProfileBand | null;
  /** Which traits fed it, strongest contribution first — the working. */
  contributions: {
    key: string;
    label: string;
    score: number;
    weight: number;
  }[];
}

export interface BehavioralAssessment {
  profiles: ProfileScore[];
  /**
   * The behavioural index: the mean of the composites, 0-100, or null when no
   * trait in the profile was measured well enough to build one.
   */
  index: number | null;
  /** Weighted-mean confidence across the composites, 0..1. */
  confidence: number;
}

/**
 * Builds the composites from a module's reported traits.
 *
 * Traits are taken as the report already presents them, which means any trait
 * needing inversion has already been flipped — so a weight here always means
 * "more of this reads as more of the composite".
 *
 * A trait the module never measured is left out of its composites entirely
 * rather than counted at a neutral 50, and the remaining weights are
 * renormalised. Filling a gap with 50 would drag every composite toward the
 * middle and present a number nobody produced; dropping it keeps the score
 * honest about resting on less.
 */
export function buildBehavioralProfiles(
  traits: ReportedTrait[],
): BehavioralAssessment {
  const byKey = new Map(traits.map((trait) => [trait.key, trait]));

  const profiles: ProfileScore[] = [];

  for (const definition of BEHAVIORAL_PROFILES) {
    const present = Object.entries(definition.weights)
      .map(([key, weight]) => ({ trait: byKey.get(key), weight }))
      .filter(
        (entry): entry is { trait: ReportedTrait; weight: number } =>
          // Present in the map is not the same as measured. The estimator
          // reports every trait the module declared, scoring an unanswered one
          // at the neutral midpoint with `confidence: 0` so the report can say
          // "no signal" rather than omit it silently. Those must not reach a
          // composite: a 50 nobody produced, carried at 35% of the blend,
          // fabricates a third of the answer and pulls it toward the middle —
          // which is precisely what the comment above this function forbids
          // and what the filter used to allow through.
          entry.trait !== undefined && entry.trait.confidence > 0,
      );

    // Nothing measured that bears on this composite: report no composite at
    // all rather than one built from nothing.
    const totalWeight = present.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight === 0) continue;

    const score =
      present.reduce((sum, e) => sum + e.trait.score * e.weight, 0) /
      totalWeight;
    const confidence =
      present.reduce((sum, e) => sum + e.trait.confidence * e.weight, 0) /
      totalWeight;

    // Below the floor the composite is still listed — a recruiter needs to see
    // that this capability was asked about and came back thin — but it carries
    // no number and no band.
    const reportable = confidence >= MIN_TRAIT_CONFIDENCE;

    profiles.push({
      key: definition.key,
      label: definition.label,
      description: definition.description,
      score: reportable ? round1(score) : null,
      confidence: round2(confidence),
      band: reportable ? bandFor(score) : null,
      contributions: present
        .map((entry) => ({
          key: entry.trait.key,
          label: entry.trait.label,
          score: entry.trait.score,
          // Renormalised, so the shares a recruiter reads always add to 1 even
          // when a trait was dropped for lack of evidence.
          weight: round2(entry.weight / totalWeight),
        }))
        .sort((a, b) => b.weight - a.weight),
    });
  }

  return {
    profiles,
    index: behavioralIndex(profiles),
    confidence: profiles.length
      ? round2(
          profiles.reduce((sum, p) => sum + p.confidence, 0) / profiles.length,
        )
      : 0,
  };
}

/**
 * The single behavioural number, or null when there is not enough evidence for
 * one.
 *
 * Composites built on traits below the reporting confidence floor are excluded:
 * an index is a headline figure and must not be carried by traits the report
 * itself refuses to call a strength or a weakness.
 */
function behavioralIndex(profiles: ProfileScore[]): number | null {
  // `score !== null` is the same test as the confidence floor — it is set by
  // it — but keying off the value means the index can never be built from a
  // number the report itself declined to show.
  const confident = profiles.filter(
    (profile): profile is ProfileScore & { score: number } =>
      profile.score !== null,
  );
  if (confident.length === 0) return null;

  return round1(
    confident.reduce((sum, profile) => sum + profile.score, 0) /
      confident.length,
  );
}

function bandFor(score: number): ProfileBand {
  if (score >= BEHAVIORAL_STRONG_AT) return 'strong';
  if (score >= BEHAVIORAL_MODERATE_AT) return 'moderate';
  return 'developing';
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
