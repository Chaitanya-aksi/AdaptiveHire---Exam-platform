import { Injectable } from '@nestjs/common';
import { ScoringType } from '../../common/enums';
import {
  PROBE_AGREEMENT_ZERO_AT,
  PROBE_GAP_QUESTIONS,
  PROBE_MAX_PAIRS,
} from '../adaptive-engine.constants';
import type {
  ModuleRunState,
  ProbeDivergence,
  ProbePair,
  ProbeResults,
  ProbeSignature,
} from '../engine.types';

/**
 * Repeat probes: ask the same thing twice, in different clothing, far enough
 * apart that the candidate does not notice.
 *
 * A single answer tells you what someone picked. It cannot tell you whether
 * they would pick it again. So questions can be authored in twinned pairs
 * sharing a `probeGroup` — same underlying construct, reworded stem, reworded
 * and reordered options — and this service makes sure the twins land far apart
 * and then compares the two answers.
 *
 * What a disagreement means depends on the module:
 *
 *   - Objective. Getting one twin right and the other wrong means the right
 *     answer was a guess. Two equivalent questions cannot both be within
 *     someone's grasp and outside it.
 *   - Trait. Choosing the collaborative option in one framing and the solitary
 *     one in an equivalent framing means the trait is not as settled as a single
 *     answer made it look.
 *
 * Neither is a lie detector, and nothing here touches a score. The service
 * observes, records both answers, and hands the recruiter the comparison.
 */
@Injectable()
export class ConsistencyProbeService {
  /**
   * The question id this module owes, or null.
   *
   * Non-null means the selector must serve exactly this question: a probe twin
   * that has come due outranks difficulty matching and trait coverage, because
   * a pair that never closes has cost a question and measured nothing.
   */
  dueTwin(state: ModuleRunState): { group: string } | null {
    // Longest-waiting first, so a pair opened early cannot be starved by a
    // later one that also came due.
    for (const pair of state.probes) {
      if (pair.secondQuestionId !== null) continue;
      if (state.answered - pair.askedAtAnswered >= PROBE_GAP_QUESTIONS) {
        return { group: pair.group };
      }
    }
    return null;
  }

  /**
   * Probe groups the selector must not serve from right now — every group the
   * module has already touched, except the one whose twin has come due.
   *
   * That single rule covers all three cases: a pair still inside its gap
   * (serving the twin now would defeat the point), a pair already closed (a
   * third question on the same construct measures nothing and would make "the
   * pair" ambiguous), and a probe question served without opening a pair
   * because the quota was full (its twin would read as a plain repeat).
   */
  blockedGroups(state: ModuleRunState): string[] {
    const due = this.dueTwin(state)?.group;
    const touched = new Set([
      ...state.servedProbeGroups,
      ...state.probes.map((pair) => pair.group),
    ]);
    touched.delete(due ?? '');

    return [...touched];
  }

  /**
   * Whether a pair is open and its twin has not yet had its turn.
   *
   * The stopping engine uses this to hold a module open when it would otherwise
   * finish on confidence: a pair that opened has already spent one of the
   * candidate's questions, and stopping one question before its twin throws that
   * away and reports nothing.
   *
   * Deliberately bounded. It stays true only up to the answer on which the twin
   * comes due, so a pair whose twin cannot be found — archived since, or deleted
   * — holds the module open for exactly one extra selection and then stops
   * asking. A module can never be extended past `maxQuestions` or its clock,
   * because both of those outrank confidence in the stopping order.
   */
  awaitingTwin(state: ModuleRunState): boolean {
    return state.probes.some(
      (pair) =>
        pair.secondQuestionId === null &&
        state.answered <= pair.askedAtAnswered + PROBE_GAP_QUESTIONS,
    );
  }

  /** Notes that a probe group has been put in front of the candidate. */
  markServed(state: ModuleRunState, group: string): void {
    if (!state.servedProbeGroups.includes(group)) {
      state.servedProbeGroups.push(group);
    }
  }

  /**
   * Whether a newly served probe question should open a pair.
   *
   * Two reasons to decline, and in both the question is still served — it is a
   * perfectly good question on its own merits, it just will not be twinned:
   *
   *   - The module has opened its quota of pairs already.
   *   - There is not enough of the module left to fit the gap plus the twin, so
   *     the pair could only ever end up unresolved.
   */
  canOpenPair(state: ModuleRunState): boolean {
    if (state.probes.length >= PROBE_MAX_PAIRS) return false;
    return state.answered + PROBE_GAP_QUESTIONS < state.maxQuestions;
  }

  /**
   * Whether the selector should go out of its way to serve a question that
   * would open a pair.
   *
   * The window for opening one is narrow and arrives immediately: with a gap of
   * 8 on a 12-question module, only the first three answers leave room for a
   * twin to come back before the module stops. Left to chance, whether a
   * candidate is checked at all comes down to whether a probe question happened
   * to turn up in those three slots — so most runs measured nothing.
   *
   * Asking for one instead makes the check reliable. It costs nothing in
   * measurement quality because the selector still applies its own rules
   * (closest difficulty, or the least-covered trait) and only prefers a probe
   * question from among the questions it would already have been willing to
   * serve.
   *
   * Deliberately only while no pair is open. Once one is running, the module
   * goes back to ordinary selection — a second pair is welcome if it turns up
   * naturally, but two probes chased in a row would start to crowd out the
   * coverage that makes the scores worth checking.
   */
  wantsNewPair(state: ModuleRunState): boolean {
    if (!this.canOpenPair(state)) return false;
    return !state.probes.some((pair) => pair.secondQuestionId === null);
  }

  /**
   * Folds one answered probe question into the module's pairs: closes the open
   * pair for its group if there is one, otherwise opens a new pair.
   *
   * `sequenceNumber` is the answer's position in the whole session, carried so
   * the report can point a recruiter at both rows of the pair.
   */
  record(
    state: ModuleRunState,
    group: string,
    questionId: string,
    sequenceNumber: number,
    signature: ProbeSignature,
  ): void {
    const open = state.probes.find(
      (pair) => pair.group === group && pair.secondQuestionId === null,
    );

    if (open) {
      this.close(open, questionId, sequenceNumber, signature);
      return;
    }

    // Opening a pair on a question that timed out unanswered would burn a pair
    // slot and a later question to compare an answer that was never given.
    if (signature.kind === 'unanswered') return;
    if (!this.canOpenPair(state)) return;

    state.probes.push({
      group,
      firstQuestionId: questionId,
      firstSequence: sequenceNumber,
      first: signature,
      // `state.answered` has already counted this answer by the time we are
      // called, so the gap is measured from the question after this one.
      askedAtAnswered: state.answered,
      secondQuestionId: null,
      secondSequence: null,
      second: null,
      agreement: null,
      flipped: null,
      divergentTraits: [],
    });
  }

  private close(
    pair: ProbePair,
    questionId: string,
    sequenceNumber: number,
    signature: ProbeSignature,
  ): void {
    pair.secondQuestionId = questionId;
    pair.secondSequence = sequenceNumber;
    pair.second = signature;

    const comparison = this.compare(pair.first, signature);
    pair.agreement = comparison.agreement;
    pair.flipped = comparison.flipped;
    pair.divergentTraits = comparison.divergentTraits;
  }

  /**
   * How closely two answers to the same construct agreed.
   *
   * A pair with an unanswered half is uncomparable rather than a disagreement:
   * running out of time is not inconsistency, and scoring it as zero would
   * punish the candidate for the clock.
   */
  compare(
    first: ProbeSignature,
    second: ProbeSignature,
  ): {
    agreement: number | null;
    flipped: boolean | null;
    divergentTraits: ProbeDivergence[];
  } {
    if (first.kind === 'unanswered' || second.kind === 'unanswered') {
      return { agreement: null, flipped: null, divergentTraits: [] };
    }

    if (first.kind === 'objective' && second.kind === 'objective') {
      const flipped = first.isCorrect !== second.isCorrect;
      // All or nothing, because the underlying fact is: either both twins fell
      // the same side of what the candidate knows, or the outcome was luck.
      return { agreement: flipped ? 0 : 1, flipped, divergentTraits: [] };
    }

    if (first.kind === 'trait' && second.kind === 'trait') {
      return this.compareTraits(first.weights, second.weights);
    }

    // One of each: the twins were authored into different modules, which is an
    // authoring error rather than something to score.
    return { agreement: null, flipped: null, divergentTraits: [] };
  }

  /**
   * Per-trait distance on the authoring scale, averaged.
   *
   * Only traits both answers touched are compared. A trait one option weights
   * and the other does not say anything about is not a disagreement — the twins
   * simply put different traits in play, and averaging in a phantom zero would
   * report authoring drift as candidate inconsistency.
   */
  private compareTraits(
    first: Record<string, number>,
    second: Record<string, number>,
  ): {
    agreement: number | null;
    flipped: null;
    divergentTraits: ProbeDivergence[];
  } {
    const shared = Object.keys(first).filter((key) => key in second);
    if (shared.length === 0) {
      return { agreement: null, flipped: null, divergentTraits: [] };
    }

    const perTrait = shared.map((key) => ({
      key,
      first: round2(first[key]),
      second: round2(second[key]),
      agreement: clamp01(
        1 - Math.abs(first[key] - second[key]) / PROBE_AGREEMENT_ZERO_AT,
      ),
    }));

    const agreement =
      perTrait.reduce((sum, trait) => sum + trait.agreement, 0) /
      perTrait.length;

    return {
      agreement: round2(agreement),
      flipped: null,
      divergentTraits: perTrait
        // Worst first, and only the ones that actually moved — a recruiter wants
        // the trait the candidate contradicted themselves on, not all ten.
        .filter((trait) => trait.agreement < 1)
        .sort((a, b) => a.agreement - b.agreement)
        .map(({ key, first: a, second: b }) => ({ key, first: a, second: b })),
    };
  }

  /** The module's probe outcome, for storage and the report. */
  results(state: ModuleRunState): ProbeResults | null {
    if (state.probes.length === 0) return null;

    const measured = state.probes.filter(
      (pair): pair is ProbePair & { agreement: number } =>
        pair.agreement !== null,
    );

    return {
      pairs: state.probes,
      agreement: measured.length
        ? round2(
            measured.reduce((sum, pair) => sum + pair.agreement, 0) /
              measured.length,
          )
        : null,
      resolved: measured.length,
      unresolved: state.probes.length - measured.length,
    };
  }

  /**
   * The comparable signature of one answer, given how its module scores.
   *
   * Kept here rather than in the ability estimator because it is the probe's
   * notion of "what did this answer amount to" — deliberately coarser than the
   * scoring, and never fed back into it.
   */
  signature(
    scoringType: ScoringType,
    outcome: {
      isCorrect: boolean | null;
      traitWeights: Record<string, number>;
    },
    answered: boolean,
  ): ProbeSignature {
    if (!answered) return { kind: 'unanswered' };

    return scoringType === ScoringType.OBJECTIVE
      ? { kind: 'objective', isCorrect: outcome.isCorrect === true }
      : { kind: 'trait', weights: outcome.traitWeights };
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
