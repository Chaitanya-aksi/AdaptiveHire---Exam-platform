import { ModuleStopReason, ScoringType } from '../common/enums';
import { AbilityEstimatorService } from './ability-estimator/ability-estimator.service';
import {
  ABILITY_CONFIDENCE_THRESHOLD,
  STARTING_ABILITY,
  TRAIT_TARGET_QUESTIONS,
} from './adaptive-engine.constants';
import type { ModuleRunState } from './engine.types';
import { EvaluationService } from './evaluation/evaluation.service';
import { StoppingEngineService } from './stopping-engine/stopping-engine.service';
import type { McqQuestionDetails } from '../question-bank/entities/mcq-question-details.entity';
import type { PersonalityQuestionDetails } from '../question-bank/entities/personality-question-details.entity';

const estimator = new AbilityEstimatorService();
const stopping = new StoppingEngineService(estimator);
const evaluation = new EvaluationService();

function objectiveState(
  overrides: Partial<ModuleRunState> = {},
): ModuleRunState {
  return {
    moduleId: 'm1',
    slug: 'aptitude',
    name: 'Aptitude',
    description: null,
    scoringType: ScoringType.OBJECTIVE,
    minQuestions: 8,
    maxQuestions: 15,
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
    ...overrides,
  };
}

function traitState(overrides: Partial<ModuleRunState> = {}): ModuleRunState {
  return objectiveState({
    slug: 'personality',
    name: 'Personality',
    scoringType: ScoringType.TRAIT,
    minQuestions: 10,
    maxQuestions: 20,
    traits: [
      { key: 'openness', label: 'Adaptability' },
      { key: 'conscientiousness', label: 'Reliability' },
    ],
    ...overrides,
  });
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
    estimator.applyTraitWeights(state.traitTallies, { openness: 2 });
    estimator.applyTraitWeights(state.traitTallies, { conscientiousness: 0 });

    const scores = estimator.traitScores(state);
    expect(scores.openness.score).toBe(100);
    expect(scores.conscientiousness.score).toBe(50);
  });

  it('reports an unmeasured trait at neutral with zero confidence', () => {
    const scores = estimator.traitScores(traitState());

    expect(scores.openness).toEqual({ score: 50, confidence: 0 });
  });
});

describe('StoppingEngineService', () => {
  it('never stops before the configured minimum, however confident', () => {
    const state = objectiveState({ minQuestions: 8 });
    answer(state, 1000, true, 7);

    expect(stopping.shouldStop(state).stop).toBe(false);
  });

  it('stops at the maximum even if the estimate has not settled', () => {
    const state = objectiveState({ minQuestions: 8, maxQuestions: 10 });
    // Alternating answers keep the estimate unsettled.
    for (let i = 0; i < 10; i += 1) answer(state, 1000, i % 2 === 0);

    expect(stopping.shouldStop(state)).toEqual({
      stop: true,
      reason: ModuleStopReason.MAX_QUESTIONS,
    });
  });

  it('stops once the estimate is settled enough', () => {
    const state = objectiveState({ minQuestions: 5, maxQuestions: 40 });
    answer(state, 1000, true, 30);

    expect(stopping.confidence(state)).toBeGreaterThanOrEqual(
      ABILITY_CONFIDENCE_THRESHOLD,
    );
    expect(stopping.shouldStop(state)).toEqual({
      stop: true,
      reason: ModuleStopReason.CONFIDENCE_REACHED,
    });
  });

  it('gives different candidates different-length modules', () => {
    // Same difficulties, same number available — only the answer pattern
    // differs. This is the "not everyone gets the same paper length" rule.
    const steady = objectiveState({ minQuestions: 5, maxQuestions: 40 });
    const streaky = objectiveState({ minQuestions: 5, maxQuestions: 40 });

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

    // Alternating right/wrong at your own level is equilibrium — the estimate
    // has found you. Answering everything right means it is still climbing,
    // so the module keeps going.
    const steadyLength = lengthOf(steady, (i) => i % 2 === 0);
    const climbingLength = lengthOf(streaky, () => true);

    expect(steadyLength).toBeLessThan(climbingLength);
    expect(steadyLength).toBeGreaterThanOrEqual(steady.minQuestions);
  });

  it('lets the clock override everything', () => {
    const state = objectiveState({
      minQuestions: 8,
      deadlineAt: 1_000,
    });

    expect(stopping.shouldStop(state, 1_001)).toEqual({
      stop: true,
      reason: ModuleStopReason.TIME_EXPIRED,
    });
  });

  it('holds a trait module open until its weakest trait is covered', () => {
    const state = traitState({ minQuestions: 2, maxQuestions: 20 });

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
    expect(stopping.shouldStop(state)).toEqual({
      stop: true,
      reason: ModuleStopReason.CONFIDENCE_REACHED,
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

  const personality = {
    options: [
      { key: 'A', text: 'Strongly agree', traitWeights: { openness: 2 } },
      { key: 'B', text: 'Disagree', traitWeights: { openness: -1 } },
    ],
  } as PersonalityQuestionDetails;

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
