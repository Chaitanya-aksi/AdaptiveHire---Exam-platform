import {
  BehavioralPattern,
  ModuleStopReason,
  ScoringType,
} from '../common/enums';
import { AbilityEstimatorService } from './ability-estimator/ability-estimator.service';
import {
  ABILITY_CONFIDENCE_THRESHOLD,
  PROBE_GAP_QUESTIONS,
  PROBE_MAX_PAIRS,
  STARTING_ABILITY,
  TRAIT_TARGET_QUESTIONS,
} from './adaptive-engine.constants';
import { ConsistencyProbeService } from './consistency-probe/consistency-probe.service';
import type { ModuleRunState } from './engine.types';
import { EvaluationService } from './evaluation/evaluation.service';
import { StoppingEngineService } from './stopping-engine/stopping-engine.service';
import type { McqQuestionDetails } from '../question-bank/entities/mcq-question-details.entity';
import type {
  PersonalityOption,
  PersonalityQuestionDetails,
} from '../question-bank/entities/personality-question-details.entity';
import type { Question } from '../question-bank/entities/question.entity';

const estimator = new AbilityEstimatorService();
const probes = new ConsistencyProbeService();
const stopping = new StoppingEngineService(estimator, probes);
const evaluation = new EvaluationService();

/** What `shouldStop` returns when the module carries on. */
const CONTINUE_DECISION = { stop: false, reason: null };

function objectiveState(
  overrides: Partial<ModuleRunState> = {},
): ModuleRunState {
  return {
    moduleId: 'm1',
    organisationId: 'org-1',
    assessmentId: 'assessment-1',
    poolRestricted: false,
    slug: 'aptitude',
    name: 'Aptitude',
    description: null,
    scoringType: ScoringType.OBJECTIVE,
    questionCount: 15,
    timeLimitSeconds: 900,
    traits: [],
    status: 'in_progress',
    startedAt: 0,
    deadlineAt: null,
    completedAt: null,
    stopReason: null,
    answered: 0,
    correct: 0,
    seenQuestionIds: [],
    ability: STARTING_ABILITY,
    information: 0,
    recentAbilities: [],
    traitTallies: {},
    patternCounts: {},
    probes: [],
    servedProbeGroups: [],
    ...overrides,
  };
}

function traitState(overrides: Partial<ModuleRunState> = {}): ModuleRunState {
  return objectiveState({
    slug: 'personality',
    name: 'Personality',
    scoringType: ScoringType.TRAIT,
    questionCount: 20,
    traits: [
      { key: 'openness', label: 'Adaptability' },
      { key: 'conscientiousness', label: 'Reliability' },
    ],
    ...overrides,
  });
}

/**
 * A personality question's stored details.
 *
 * The evaluation service reads only `pattern` and `options`; the rest of the
 * row exists so the fixture is a real entity rather than a cast through
 * `unknown`, which would let a genuine shape mismatch through unnoticed.
 *
 * Trait keys in these fixtures are arbitrary — evaluation never interprets a
 * trait name, it only tallies whatever the options declare.
 */
function personalityDetails(
  pattern: BehavioralPattern | null,
  options: PersonalityOption[],
): PersonalityQuestionDetails {
  return {
    questionId: 'q-fixture',
    question: undefined as unknown as Question,
    timesUsed: 0,
    pattern,
    options,
  };
}

/** Answers `count` questions at the given difficulty, right or wrong. */
function answer(
  state: ModuleRunState,
  difficulty: number,
  isCorrect: boolean,
  count = 1,
): void {
  for (let i = 0; i < count; i += 1) {
    const before = state.ability;
    const update = estimator.update(
      before,
      difficulty,
      isCorrect,
      state.answered,
    );
    state.information += estimator.information(before, difficulty);
    state.ability = update.ability;
    estimator.trackAbility(state, update.ability);
    state.answered += 1;
    if (isCorrect) state.correct += 1;
  }
}

describe('AbilityEstimatorService', () => {
  it('gives an evenly matched candidate a 50% expected score', () => {
    expect(estimator.expectedScore(1000, 1000)).toBeCloseTo(0.5, 10);
  });

  it('follows the Elo curve: 400 points of advantage is a 10:1 edge', () => {
    expect(estimator.expectedScore(1400, 1000)).toBeCloseTo(10 / 11, 10);
    expect(estimator.expectedScore(1000, 1400)).toBeCloseTo(1 / 11, 10);
  });

  it('raises ability on a correct answer and lowers it on a wrong one', () => {
    const up = estimator.update(1000, 1000, true, 0);
    const down = estimator.update(1000, 1000, false, 0);

    expect(up.ability).toBeGreaterThan(1000);
    expect(down.ability).toBeLessThan(1000);
    // Symmetric around an evenly matched question.
    expect(up.ability - 1000).toBeCloseTo(1000 - down.ability, 10);
  });

  it('moves the estimate less as the module goes on', () => {
    const early = estimator.update(1000, 1000, true, 0);
    const late = estimator.update(1000, 1000, true, 20);

    expect(early.ability - 1000).toBeGreaterThan(late.ability - 1000);
  });

  it('barely moves the estimate for an unsurprising answer', () => {
    // A strong candidate getting an easy question right tells us almost nothing.
    const expected = estimator.update(1400, 600, true, 0);
    const surprising = estimator.update(1400, 600, false, 0);

    expect(expected.ability - 1400).toBeLessThan(5);
    expect(1400 - surprising.ability).toBeGreaterThan(40);
  });

  it('drifts the question difficulty in the opposite direction, slowly', () => {
    const update = estimator.update(1000, 1000, true, 0);

    expect(update.questionDifficulty).toBeLessThan(1000);
    // The item moves far less than the candidate does.
    expect(1000 - update.questionDifficulty).toBeLessThan(
      update.ability - 1000,
    );
  });

  it('has no confidence before the first answer', () => {
    expect(estimator.abilityConfidence(objectiveState())).toBe(0);
  });

  it('gains precision fastest from well-matched questions', () => {
    const matched = objectiveState();
    const mismatched = objectiveState();
    answer(matched, 1000, true, 1);
    answer(mismatched, 100, true, 1);

    expect(estimator.precisionConfidence(matched)).toBeGreaterThan(
      estimator.precisionConfidence(mismatched),
    );
  });

  it('claims no stability until the trailing window is full', () => {
    const state = objectiveState();
    answer(state, 1000, true, 3);

    expect(estimator.stabilityConfidence(state)).toBe(0);
  });

  it('rates a settled estimate as more stable than a swinging one', () => {
    const settled = objectiveState();
    const swinging = objectiveState();
    // Alternating right/wrong at your own level is equilibrium; a streak means
    // the estimate is still travelling.
    for (let i = 0; i < 8; i += 1) answer(settled, 1000, i % 2 === 0);
    for (let i = 0; i < 8; i += 1) answer(swinging, 1000, i < 4);

    expect(estimator.stabilityConfidence(settled)).toBeGreaterThan(
      estimator.stabilityConfidence(swinging),
    );
  });

  it('rescales trait weights onto 0-100 with the midpoint at neutral', () => {
    const state = traitState();
    estimator.applyTraitWeights(state.traitTallies, { openness: 3 });
    estimator.applyTraitWeights(state.traitTallies, { conscientiousness: 0 });

    const scores = estimator.traitScores(state);
    expect(scores.openness.score).toBe(100);
    expect(scores.conscientiousness.score).toBe(50);
  });

  it('leaves a legacy +-2 option short of the extremes', () => {
    // Weights are authored on a -3..+3 scale now. A legacy Likert option maxes
    // out at +2, so it can move a trait a long way but never all the way —
    // an agree/disagree statement is weaker evidence than a behavioural choice.
    const state = traitState();
    estimator.applyTraitWeights(state.traitTallies, { openness: 2 });

    expect(estimator.traitScores(state).openness.score).toBe(83.3);
  });

  it('clamps a weight authored outside the declared range', () => {
    // Defence in depth against bad authoring: an out-of-range weight must not
    // surface as a score above 100, which would read as a real result.
    const state = traitState();
    estimator.applyTraitWeights(state.traitTallies, { openness: 9 });
    estimator.applyTraitWeights(state.traitTallies, { conscientiousness: -9 });

    const scores = estimator.traitScores(state);
    expect(scores.openness.score).toBe(100);
    expect(scores.conscientiousness.score).toBe(0);
  });

  it('reports an unmeasured trait at neutral with zero confidence', () => {
    const scores = estimator.traitScores(traitState());

    expect(scores.openness).toEqual({
      score: 50,
      confidence: 0,
      // Never 1: no answers is not the same as perfectly consistent answers.
      consistency: null,
    });
  });
});

describe('per-item trait normalisation', () => {
  /**
   * A deliberately skewed question, of the shape the whole starter bank turned
   * out to have: three creditable options and one poor one, so picking blind
   * still averages well above zero on the authoring scale.
   */
  const skewed = personalityDetails(BehavioralPattern.SITUATIONAL, [
    { key: 'A', text: 'Best', traitWeights: { openness: 3 } },
    { key: 'B', text: 'Good', traitWeights: { openness: 2 } },
    { key: 'C', text: 'Silent', traitWeights: { conscientiousness: 1 } },
    { key: 'D', text: 'Poor', traitWeights: { openness: -3 } },
  ]);

  /** Every ordering of `items` — the spec's own, so it checks the real one. */
  function permute<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items.slice()];
    return items.flatMap((item, i) =>
      permute([...items.slice(0, i), ...items.slice(i + 1)]).map((tail) => [
        item,
        ...tail,
      ]),
    );
  }

  /** Answers `details` with `key`, applying the weights and the scale together. */
  function choose(
    state: ModuleRunState,
    details: PersonalityQuestionDetails,
    key: string,
    isRanking = false,
  ): void {
    const { traitWeights } = isRanking
      ? evaluation.evaluateRanking(details, key.split(''))
      : evaluation.evaluatePersonality(details, key);

    estimator.applyTraitWeights(
      state.traitTallies,
      traitWeights,
      evaluation.achievableTraitRange(details, isRanking),
    );
  }

  it('measures the range against every answer, silence included', () => {
    const range = evaluation.achievableTraitRange(skewed, false);

    // Option C says nothing about openness, which is a contribution of zero and
    // one of the four answers on offer — so it sits inside the range and pulls
    // the chance point down. (3 + 2 + 0 - 3) / 4 = 0.5.
    expect(range.openness).toEqual({ chance: 0.5, best: 3, worst: -3 });
  });

  it('puts a random responder at exactly 50 where the old scale put them at 58', () => {
    // The whole reason this exists, and the one property that has to hold
    // exactly. Averaged over the four answers the question offers, a blind
    // choice contributes +0.5 on the -3..+3 authoring scale, which the old
    // fixed rescaling reported as 58.3/100 — a pass mark for answering at
    // random. Against what the question actually made possible it is 50.
    const scores = ['A', 'B', 'C', 'D'].map((key) => {
      const state = traitState();
      choose(state, skewed, key);
      return estimator.traitScores(state).openness.score;
    });

    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    expect(mean).toBeCloseTo(50, 5);

    // And the same four answers on the pre-change scale, for the contrast.
    const legacy = ['A', 'B', 'C', 'D'].map((key) => {
      const state = traitState();
      const { traitWeights } = evaluation.evaluatePersonality(skewed, key);
      estimator.applyTraitWeights(state.traitTallies, traitWeights);
      return estimator.traitScores(state).openness.score;
    });
    expect(
      legacy.reduce((sum, score) => sum + score, 0) / legacy.length,
    ).toBeCloseTo(58.3, 1);
  });

  it('reaches both extremes on a question with symmetric options', () => {
    const balanced = personalityDetails(BehavioralPattern.SITUATIONAL, [
      { key: 'A', text: 'Best', traitWeights: { openness: 3 } },
      { key: 'B', text: 'Good', traitWeights: { openness: 1 } },
      { key: 'C', text: 'Poor', traitWeights: { openness: -1 } },
      { key: 'D', text: 'Worst', traitWeights: { openness: -3 } },
    ]);

    const best = traitState();
    const worst = traitState();
    for (let i = 0; i < 4; i += 1) {
      choose(best, balanced, 'A');
      choose(worst, balanced, 'D');
    }

    expect(estimator.traitScores(best).openness.score).toBe(100);
    expect(estimator.traitScores(worst).openness.score).toBe(0);
  });

  it('stops short of 100 where a question has more room down than up', () => {
    // `skewed` runs +3 to -3 around a chance point of +0.5, so there is 2.5 of
    // room above chance and 3.5 below. One slope has to serve both, and it is
    // sized by the wider one — otherwise the mapping bends and the 50-point
    // stops meaning chance. Answering as well as the question allows therefore
    // reads as 85.7, and that is the honest number: this question does not
    // offer as far up as it does down.
    const best = traitState();
    for (let i = 0; i < 4; i += 1) choose(best, skewed, 'A');

    expect(estimator.traitScores(best).openness.score).toBeCloseTo(85.7, 1);
    // The bad end is the wider one, so it still lands exactly on the floor.
    const worst = traitState();
    for (let i = 0; i < 4; i += 1) choose(worst, skewed, 'D');
    expect(estimator.traitScores(worst).openness.score).toBe(0);
  });

  it('holds the 50-point for a ranking question too', () => {
    // Every ordering is equally likely under a blind answer, so the mean across
    // all 24 of them has to land on 50 — the position factors are symmetric
    // about zero, which is what makes a ranking's chance value exactly zero.
    const ranked = personalityDetails(BehavioralPattern.RANKING, [
      { key: 'A', text: 'a', traitWeights: { openness: 3 } },
      { key: 'B', text: 'b', traitWeights: { openness: 2 } },
      { key: 'C', text: 'c', traitWeights: { openness: 1 } },
      { key: 'D', text: 'd', traitWeights: { openness: 3 } },
    ]);

    const orders = ['ABCD', 'ABDC', 'ACBD', 'ACDB', 'ADBC', 'ADCB'];
    const scores = orders.map((order) => {
      const state = traitState();
      choose(state, ranked, order, true);
      return estimator.traitScores(state).openness.score;
    });

    expect(Math.max(...scores)).toBeGreaterThan(50);
    expect(Math.min(...scores)).toBeLessThan(50);
    expect(
      evaluation.achievableTraitRange(ranked, true).openness.chance,
    ).toBeCloseTo(0, 10);

    // Averaged over every one of the 24 orderings, not just the six above.
    const all = permute(['A', 'B', 'C', 'D']).map((order) => {
      const state = traitState();
      choose(state, ranked, order.join(''), true);
      return estimator.traitScores(state).openness.score;
    });
    expect(all.reduce((sum, s) => sum + s, 0) / all.length).toBeCloseTo(50, 5);
  });

  it('leaves count, confidence and consistency exactly where they were', () => {
    // The scale changed; what counts as evidence did not. Confidence drives
    // trait coverage in the selector and the trait module's stop condition, so
    // a drifting count here would quietly change how long a section runs.
    const withRange = traitState();
    const without = traitState();
    for (const key of ['A', 'B', 'D']) {
      choose(withRange, skewed, key);
      const { traitWeights } = evaluation.evaluatePersonality(skewed, key);
      estimator.applyTraitWeights(without.traitTallies, traitWeights);
    }

    expect(withRange.traitTallies.openness.count).toBe(
      without.traitTallies.openness.count,
    );
    expect(estimator.traitScores(withRange).openness.confidence).toBe(
      estimator.traitScores(without).openness.confidence,
    );
    expect(estimator.traitScores(withRange).openness.consistency).toBe(
      estimator.traitScores(without).openness.consistency,
    );
  });

  it('charges nothing for a question the clock took away', () => {
    // An unanswered question passes no range, so it moves neither the score nor
    // its scale. Holding a candidate to the chance value of a question they
    // never saw the end of would read as having answered it badly.
    const state = traitState();
    choose(state, skewed, 'A');
    const answered = estimator.traitScores(state).openness.score;

    estimator.applyTraitWeights(state.traitTallies, {}, undefined);
    expect(estimator.traitScores(state).openness.score).toBe(answered);
  });

  it('keeps scoring a tally recorded before the scale existed', () => {
    // A stored result or an in-flight Redis session carries no chanceSum.
    // Rescoring it against a scale its questions were never measured on would
    // change a number a recruiter may already have read.
    const state = traitState();
    state.traitTallies.openness = { sum: 2, count: 1, sumSquares: 4 };

    expect(estimator.traitScores(state).openness.score).toBe(83.3);
  });
});

describe('StoppingEngineService', () => {
  it('never stops before the configured minimum, however confident', () => {
    const state = objectiveState({ questionCount: 8 });
    answer(state, 1000, true, 7);

    expect(stopping.shouldStop(state).stop).toBe(false);
  });

  it('stops at the maximum even if the estimate has not settled', () => {
    const state = objectiveState({ questionCount: 10 });
    // Alternating answers keep the estimate unsettled.
    for (let i = 0; i < 10; i += 1) answer(state, 1000, i % 2 === 0);

    expect(stopping.shouldStop(state)).toEqual({
      stop: true,
      reason: ModuleStopReason.MAX_QUESTIONS,
    });
  });

  it('keeps going once settled — a section runs to its full length', () => {
    const state = objectiveState({ questionCount: 40 });
    answer(state, 1000, true, 30);

    // The measurement survives the change: the engine still knows how settled
    // the estimate is. What it no longer does is end the section over it.
    expect(stopping.confidence(state)).toBeGreaterThanOrEqual(
      ABILITY_CONFIDENCE_THRESHOLD,
    );
    expect(stopping.thresholdMet(state)).toBe(true);
    expect(stopping.shouldStop(state)).toEqual({ stop: false, reason: null });
  });

  it('stops exactly at the configured count', () => {
    const state = objectiveState({ questionCount: 12 });
    answer(state, 1000, true, 11);
    expect(stopping.shouldStop(state)).toEqual({ stop: false, reason: null });

    answer(state, 1000, true, 1);
    expect(stopping.shouldStop(state)).toEqual({
      stop: true,
      reason: ModuleStopReason.MAX_QUESTIONS,
    });
  });

  it('gives every candidate the same length, whatever they answer', () => {
    // This asserts the inverse of the rule it replaced. Sections used to end
    // early once the estimate settled, so two candidates sat the same section
    // and answered a different number of questions; they are fixed length now,
    // which is what makes two results comparable on the same number of items.
    const steady = objectiveState({ questionCount: 40 });
    const streaky = objectiveState({ questionCount: 40 });

    const lengthOf = (
      state: ModuleRunState,
      isCorrect: (index: number) => boolean,
    ): number => {
      let asked = 0;
      while (!stopping.shouldStop(state).stop && asked < 40) {
        answer(state, Math.round(state.ability), isCorrect(asked));
        asked += 1;
      }
      return asked;
    };

    // Alternating right/wrong at your own level, versus answering everything
    // right: two completely different runs through the section.
    const steadyLength = lengthOf(steady, (i) => i % 2 === 0);
    const climbingLength = lengthOf(streaky, () => true);

    expect(steadyLength).toBe(40);
    expect(climbingLength).toBe(40);

    // The lengths match; the *estimates* do not. That is the whole point — the
    // section adapts in difficulty rather than in length, so a candidate who
    // answered everything correctly still ends up rated far above one who
    // alternated, on the same number of questions.
    expect(streaky.ability).toBeGreaterThan(steady.ability);
  });

  it('lets the clock override everything', () => {
    const state = objectiveState({
      questionCount: 8,
      deadlineAt: 1_000,
    });

    expect(stopping.shouldStop(state, 1_001)).toEqual({
      stop: true,
      reason: ModuleStopReason.TIME_EXPIRED,
    });
  });

  it('holds a trait module open until its weakest trait is covered', () => {
    const state = traitState({ questionCount: 20 });

    for (let i = 0; i < TRAIT_TARGET_QUESTIONS; i += 1) {
      estimator.applyTraitWeights(state.traitTallies, { openness: 1 });
      state.answered += 1;
    }
    expect(stopping.shouldStop(state).stop).toBe(false);

    for (let i = 0; i < TRAIT_TARGET_QUESTIONS; i += 1) {
      estimator.applyTraitWeights(state.traitTallies, {
        conscientiousness: 1,
      });
      state.answered += 1;
    }
    // Settled, and still going: the trait profile keeps collecting answers to
    // the end of the section like everything else.
    expect(stopping.thresholdMet(state)).toBe(true);
    expect(stopping.shouldStop(state).stop).toBe(false);
  });

  /**
   * Repeat probes no longer reach the stopping decision at all.
   *
   * They used to: a settled module was held open a question or two so a pair
   * already opened could close, because stopping first would have spent a
   * question and reported nothing for it. With sections at a fixed length there
   * is no early stop left to defer, so the deferral went with it — and the
   * pairs land anyway, because a fixed section is far longer than the eight-
   * question gap a pair needs.
   */
  describe('repeat probes and the stopping decision', () => {
    /** A settled objective module with one probe pair open at `openedAt`. */
    function settledWithOpenPair(openedAt: number, questionCount = 40) {
      const state = objectiveState({ questionCount });
      answer(state, 1000, true, 30);
      state.probes.push({
        group: 'ratio-1',
        firstQuestionId: 'q1',
        firstSequence: openedAt,
        first: { kind: 'objective', isCorrect: true },
        askedAtAnswered: openedAt,
        secondQuestionId: null,
        secondSequence: null,
        second: null,
        agreement: null,
        flipped: null,
        divergentTraits: [],
      });
      return state;
    }

    it('an open pair does not keep a full section running', () => {
      // Thirty answers into a thirty-question section with a pair still open.
      // The old engine held on for the twin; this one is simply finished.
      const state = settledWithOpenPair(30, 30);

      expect(state.answered).toBe(30);
      expect(stopping.shouldStop(state)).toEqual({
        stop: true,
        reason: ModuleStopReason.MAX_QUESTIONS,
      });
    });

    it('an open pair does not end a section early either', () => {
      // Settled, pair open, and well short of the count: neither fact matters
      // any more. The section runs on because it has questions left.
      const state = settledWithOpenPair(30);

      expect(stopping.thresholdMet(state)).toBe(true);
      expect(stopping.shouldStop(state)).toEqual({ stop: false, reason: null });
    });

    it('leaves room for the twin at a realistic section length', () => {
      // The reason the deferral is no longer needed. A pair opened at question
      // 30 of a 40-question section has its twin due at 38, comfortably inside
      // the section — where the old 12-question modules had three slots.
      const state = settledWithOpenPair(30, 40);

      expect(state.questionCount - state.answered).toBeGreaterThan(
        PROBE_GAP_QUESTIONS,
      );
    });

    it('never defers past the clock', () => {
      const state = settledWithOpenPair(30);
      state.deadlineAt = 1_000;

      expect(stopping.shouldStop(state, 1_001)).toEqual({
        stop: true,
        reason: ModuleStopReason.TIME_EXPIRED,
      });
    });

    it('does not let a probe drag a module past its minimum question count', () => {
      // Below the minimum nothing has been earned yet, so the answer is the
      // same "continue" it always was — not a probe-driven deferral.
      const state = objectiveState({ questionCount: 8 });
      answer(state, 1000, true, 3);

      expect(stopping.thresholdMet(state)).toBe(false);
      expect(stopping.shouldStop(state)).toEqual(CONTINUE_DECISION);
    });
  });
});

describe('EvaluationService', () => {
  const mcq = {
    options: [
      { key: 'A', text: '10' },
      { key: 'B', text: '12' },
    ],
    correctOption: 'B',
  } as McqQuestionDetails;

  const personality = personalityDetails(null, [
    // Legacy Likert shape, hence a null pattern.
    { key: 'A', text: 'Strongly agree', traitWeights: { openness: 2 } },
    { key: 'B', text: 'Disagree', traitWeights: { openness: -1 } },
  ]);

  /** Four options whose weights make the position factors easy to read off. */
  const ranking = personalityDetails(BehavioralPattern.RANKING, [
    { key: 'A', text: 'Planning', traitWeights: { conscientiousness: 3 } },
    { key: 'B', text: 'Leading', traitWeights: { openness: 3 } },
    { key: 'C', text: 'Creating', traitWeights: { openness: 3 } },
    {
      key: 'D',
      text: 'Risk-taking',
      traitWeights: { openness: 3, conscientiousness: -3 },
    },
  ]);

  describe('ranking', () => {
    it('weights the first choice fully and the last choice inversely', () => {
      const { traitWeights } = evaluation.evaluateRanking(ranking, [
        'A',
        'B',
        'C',
        'D',
      ]);

      // A first: conscientiousness 3 * +1. D last: conscientiousness -3 * -1,
      // which also ADDS 3 — ranking "risk-taking" last is a statement in
      // favour of conscientiousness, not the absence of one. Averaged over the
      // two options that mention it: +3.
      expect(traitWeights.conscientiousness).toBeCloseTo(3);
      // B at +1/3 and C at -1/3 cancel each other out, leaving D last at
      // 3 * -1; averaged over the three options that mention it: -1.
      expect(traitWeights.openness).toBeCloseTo(-1);
    });

    it('keeps a ranking contribution inside the -3..+3 weight scale', () => {
      // Otherwise one ranking would count for more than one situational
      // answer, and the pattern mix a candidate happened to get would move
      // their scores as much as their answers did.
      for (const order of [
        ['A', 'B', 'C', 'D'],
        ['D', 'C', 'B', 'A'],
        ['B', 'D', 'A', 'C'],
      ]) {
        const { traitWeights } = evaluation.evaluateRanking(ranking, order);
        for (const weight of Object.values(traitWeights)) {
          expect(Math.abs(weight)).toBeLessThanOrEqual(3);
        }
      }
    });

    it('produces a different profile when the order is reversed', () => {
      const forward = evaluation.evaluateRanking(ranking, ['A', 'B', 'C', 'D']);
      const reversed = evaluation.evaluateRanking(ranking, [
        'D',
        'C',
        'B',
        'A',
      ]);

      expect(reversed.traitWeights.conscientiousness).toBeCloseTo(
        -forward.traitWeights.conscientiousness,
      );
      expect(reversed.traitWeights.openness).toBeCloseTo(
        -forward.traitWeights.openness,
      );
    });

    it('lets one answer move several traits at once', () => {
      const { traitWeights } = evaluation.evaluateRanking(ranking, [
        'D',
        'A',
        'B',
        'C',
      ]);

      expect(Object.keys(traitWeights).sort()).toEqual([
        'conscientiousness',
        'openness',
      ]);
    });

    it('rejects an incomplete ranking', () => {
      expect(() => evaluation.evaluateRanking(ranking, ['A', 'B'])).toThrow(
        /Rank all 4 options/,
      );
    });

    it('rejects a duplicated option', () => {
      expect(() =>
        evaluation.evaluateRanking(ranking, ['A', 'B', 'B', 'C']),
      ).toThrow(/"B" appears more than once/);
    });

    it('rejects an option that is not on the question', () => {
      expect(() =>
        evaluation.evaluateRanking(ranking, ['A', 'B', 'C', 'Z']),
      ).toThrow(/not one of this question's options/);
    });
  });

  describe('consistency', () => {
    /** Applies a run of weights to one trait, as separate answers. */
    const answerWith = (state: ModuleRunState, weights: number[]) => {
      for (const weight of weights) {
        estimator.applyTraitWeights(state.traitTallies, { openness: weight });
      }
    };

    it('reports nothing until a trait has two contributions', () => {
      const state = traitState();
      answerWith(state, [3]);

      expect(
        estimator.traitConsistency(state.traitTallies.openness),
      ).toBeNull();
    });

    it('rates identical contributions as fully consistent', () => {
      const state = traitState();
      answerWith(state, [2, 2, 2]);

      expect(estimator.traitConsistency(state.traitTallies.openness)).toBe(1);
    });

    it('drops when the same trait is expressed differently across contexts', () => {
      // The proposal's own example: collaborative in one scenario, solitary in
      // another. Not dishonesty — the trait simply did not hold across
      // situations, and the score carries that caveat.
      const consistent = traitState();
      answerWith(consistent, [3, 3]);

      const varied = traitState();
      answerWith(varied, [3, -1]);

      const high = estimator.traitConsistency(consistent.traitTallies.openness);
      const low = estimator.traitConsistency(varied.traitTallies.openness);

      expect(low).toBeLessThan(high!);
      expect(low).toBeGreaterThan(0);
    });

    it('bottoms out at zero for opposite extremes', () => {
      const state = traitState();
      answerWith(state, [3, -3]);

      expect(estimator.traitConsistency(state.traitTallies.openness)).toBe(0);
    });

    it('averages only the traits with enough evidence', () => {
      const state = traitState();
      answerWith(state, [2, 2]);
      // One lonely contribution: measured for score, ignored for consistency.
      estimator.applyTraitWeights(state.traitTallies, {
        conscientiousness: 1,
      });

      expect(estimator.overallConsistency(state)).toBe(1);
    });

    it('has no overall figure before any trait qualifies', () => {
      expect(estimator.overallConsistency(traitState())).toBeNull();
    });
  });

  it('scores an MCQ against the stored correct option', () => {
    expect(evaluation.evaluateMcq(mcq, 'B').isCorrect).toBe(true);
    expect(evaluation.evaluateMcq(mcq, 'A').isCorrect).toBe(false);
  });

  it('rejects an option the question does not have', () => {
    expect(() => evaluation.evaluateMcq(mcq, 'Z')).toThrow(/not one of/);
  });

  it('returns the chosen option weights for a trait question', () => {
    expect(evaluation.evaluatePersonality(personality, 'A')).toEqual({
      isCorrect: null,
      traitWeights: { openness: 2 },
    });
  });

  it('counts an unanswered objective question as wrong, a trait one as nothing', () => {
    expect(evaluation.evaluateUnanswered(ScoringType.OBJECTIVE)).toEqual({
      isCorrect: false,
      traitWeights: {},
    });
    expect(evaluation.evaluateUnanswered(ScoringType.TRAIT)).toEqual({
      isCorrect: null,
      traitWeights: {},
    });
  });
});

/**
 * Repeat probes. The mechanism is entirely about the gap: a twin served too
 * soon is recognised, and a recognised twin measures memory rather than
 * consistency. These tests pin the gap, the hold-back, and what a pair of
 * answers is taken to mean.
 */
describe('ConsistencyProbeService', () => {
  /** Answers a probe question, driving `answered` the way a real run would. */
  function probeAnswer(
    state: ModuleRunState,
    group: string,
    questionId: string,
    signature: Parameters<typeof probes.record>[4],
  ): void {
    state.answered += 1;
    probes.markServed(state, group);
    probes.record(state, group, questionId, state.answered, signature);
  }

  const correct = { kind: 'objective', isCorrect: true } as const;
  const wrong = { kind: 'objective', isCorrect: false } as const;

  describe('the gap', () => {
    it('holds a twin back until the gap has passed', () => {
      const state = objectiveState();
      probeAnswer(state, 'ratio-1', 'q1', correct);

      // One short of the gap: still nothing owed.
      state.answered = PROBE_GAP_QUESTIONS;
      expect(probes.dueTwin(state)).toBeNull();
      expect(probes.blockedGroups(state)).toEqual(['ratio-1']);
    });

    it('owes the twin once the gap has passed, and unblocks its group', () => {
      const state = objectiveState();
      probeAnswer(state, 'ratio-1', 'q1', correct);

      state.answered = PROBE_GAP_QUESTIONS + 1;
      expect(probes.dueTwin(state)).toEqual({ group: 'ratio-1' });
      // Unblocked so the selector's base query can reach the twin.
      expect(probes.blockedGroups(state)).toEqual([]);
    });

    it('keeps a closed group blocked, so no third question repeats it', () => {
      const state = objectiveState();
      probeAnswer(state, 'ratio-1', 'q1', correct);
      state.answered = PROBE_GAP_QUESTIONS + 1;
      probeAnswer(state, 'ratio-1', 'q2', correct);

      expect(probes.dueTwin(state)).toBeNull();
      expect(probes.blockedGroups(state)).toEqual(['ratio-1']);
    });

    it('serves the longest-waiting twin first', () => {
      const state = objectiveState();
      probeAnswer(state, 'first', 'q1', correct);
      probeAnswer(state, 'second', 'q2', correct);

      state.answered = PROBE_GAP_QUESTIONS + 2;
      expect(probes.dueTwin(state)).toEqual({ group: 'first' });
    });
  });

  describe('opening a pair', () => {
    it('stops at the pair quota', () => {
      const state = objectiveState();
      for (let i = 0; i < PROBE_MAX_PAIRS; i += 1) {
        probeAnswer(state, `group-${i}`, `q${i}`, correct);
      }

      expect(probes.canOpenPair(state)).toBe(false);
    });

    it('still blocks a group served past the quota', () => {
      const state = objectiveState();
      for (let i = 0; i < PROBE_MAX_PAIRS; i += 1) {
        probeAnswer(state, `group-${i}`, `q${i}`, correct);
      }
      // Served as an ordinary question — no pair opened for it.
      probeAnswer(state, 'extra', 'q-extra', correct);

      expect(state.probes).toHaveLength(PROBE_MAX_PAIRS);
      // ...but its twin must still stay out of the paper, or the candidate
      // meets an obvious repeat that measures nothing.
      expect(probes.blockedGroups(state)).toContain('extra');
    });

    it('declines a pair that could not close before the module ends', () => {
      const state = objectiveState({
        questionCount: 10,
        answered: 10 - PROBE_GAP_QUESTIONS,
      });

      expect(probes.canOpenPair(state)).toBe(false);
    });

    it('opens nothing for a question that timed out unanswered', () => {
      const state = objectiveState();
      probeAnswer(state, 'ratio-1', 'q1', { kind: 'unanswered' });

      expect(state.probes).toEqual([]);
    });
  });

  /**
   * The selector asks for a probe question rather than waiting for one to turn
   * up. The window is only as wide as `questionCount - PROBE_GAP_QUESTIONS`, so
   * left to chance most runs never opened a pair at all.
   */
  describe('asking for an opener', () => {
    it('wants one straight away, while there is room to close it', () => {
      expect(probes.wantsNewPair(objectiveState({ questionCount: 12 }))).toBe(
        true,
      );
    });

    it('stops wanting one while a pair is already open', () => {
      const state = objectiveState({ questionCount: 12 });
      probeAnswer(state, 'ratio-1', 'q1', correct);

      // A second pair is welcome if it appears naturally, but chasing one would
      // crowd out the coverage the probes exist to check.
      expect(probes.wantsNewPair(state)).toBe(false);
    });

    it('wants another once the open pair has closed', () => {
      const state = objectiveState({ questionCount: 30 });
      probeAnswer(state, 'ratio-1', 'q1', correct);
      state.answered = PROBE_GAP_QUESTIONS + 1;
      probeAnswer(state, 'ratio-1', 'q2', correct);

      expect(probes.wantsNewPair(state)).toBe(true);
    });

    it('stops asking once the module is too far along to close one', () => {
      const state = objectiveState({
        questionCount: 12,
        answered: 12 - PROBE_GAP_QUESTIONS,
      });

      expect(probes.wantsNewPair(state)).toBe(false);
    });

    it('stops asking at the pair quota', () => {
      const state = objectiveState({ questionCount: 40 });
      for (let i = 0; i < PROBE_MAX_PAIRS; i += 1) {
        probeAnswer(state, `group-${i}`, `q${i}a`, correct);
        state.answered += PROBE_GAP_QUESTIONS;
        probeAnswer(state, `group-${i}`, `q${i}b`, correct);
      }

      expect(state.probes).toHaveLength(PROBE_MAX_PAIRS);
      expect(probes.wantsNewPair(state)).toBe(false);
    });
  });

  describe('objective agreement', () => {
    it('reads a flip as the right answer having been a guess', () => {
      const state = objectiveState();
      probeAnswer(state, 'ratio-1', 'q1', correct);
      state.answered = PROBE_GAP_QUESTIONS + 1;
      probeAnswer(state, 'ratio-1', 'q2', wrong);

      const results = probes.results(state);
      expect(results?.pairs[0].agreement).toBe(0);
      expect(results?.pairs[0].flipped).toBe(true);
      expect(results?.agreement).toBe(0);
      expect(results?.resolved).toBe(1);
    });

    it('reads two wrong answers as consistent, not as a second failure', () => {
      const state = objectiveState();
      probeAnswer(state, 'ratio-1', 'q1', wrong);
      state.answered = PROBE_GAP_QUESTIONS + 1;
      probeAnswer(state, 'ratio-1', 'q2', wrong);

      expect(probes.results(state)?.pairs[0].agreement).toBe(1);
      expect(probes.results(state)?.pairs[0].flipped).toBe(false);
    });
  });

  describe('trait agreement', () => {
    const traitSignature = (weights: Record<string, number>) =>
      ({ kind: 'trait', weights }) as const;

    it('scores an identical choice as full agreement', () => {
      expect(
        probes.compare(
          traitSignature({ teamwork: 3 }),
          traitSignature({ teamwork: 3 }),
        ).agreement,
      ).toBe(1);
    });

    it('scores opposite extremes as none', () => {
      const { agreement, divergentTraits } = probes.compare(
        traitSignature({ teamwork: 3 }),
        traitSignature({ teamwork: -3 }),
      );

      expect(agreement).toBe(0);
      expect(divergentTraits).toEqual([
        { key: 'teamwork', first: 3, second: -3 },
      ]);
    });

    it('averages across the traits both answers touched', () => {
      // teamwork identical (1.0), empathy 3 apart on a 6-point span (0.5).
      const { agreement, divergentTraits } = probes.compare(
        traitSignature({ teamwork: 2, empathy: 3 }),
        traitSignature({ teamwork: 2, empathy: 0 }),
      );

      expect(agreement).toBe(0.75);
      // Only the trait that actually moved is called out.
      expect(divergentTraits).toEqual([
        { key: 'empathy', first: 3, second: 0 },
      ]);
    });

    it('ignores a trait only one of the twins weights', () => {
      // Authoring drift, not candidate inconsistency: averaging in a phantom
      // zero for `integrity` would report the author's mistake as the
      // candidate's contradiction.
      expect(
        probes.compare(
          traitSignature({ teamwork: 3, integrity: 3 }),
          traitSignature({ teamwork: 3 }),
        ).agreement,
      ).toBe(1);
    });

    it('has no figure when the twins share no trait at all', () => {
      expect(
        probes.compare(
          traitSignature({ teamwork: 3 }),
          traitSignature({ integrity: 3 }),
        ).agreement,
      ).toBeNull();
    });
  });

  describe('uncomparable pairs', () => {
    it('does not score a timed-out twin as a disagreement', () => {
      const state = objectiveState();
      probeAnswer(state, 'ratio-1', 'q1', correct);
      state.answered = PROBE_GAP_QUESTIONS + 1;
      probeAnswer(state, 'ratio-1', 'q2', { kind: 'unanswered' });

      const results = probes.results(state);
      // Null, never zero: running out of time is not inconsistency.
      expect(results?.pairs[0].agreement).toBeNull();
      expect(results?.agreement).toBeNull();
      expect(results?.resolved).toBe(0);
      expect(results?.unresolved).toBe(1);
    });

    it('reports a pair whose twin never came round as unresolved', () => {
      const state = objectiveState();
      probeAnswer(state, 'ratio-1', 'q1', correct);

      expect(probes.results(state)).toEqual({
        pairs: state.probes,
        agreement: null,
        resolved: 0,
        unresolved: 1,
      });
    });

    it('has no results at all when no pair was opened', () => {
      expect(probes.results(objectiveState())).toBeNull();
    });
  });
});
