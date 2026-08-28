/**
 * What does answering at random actually score?
 *
 * Runs simulated candidates through the real evaluation and estimation
 * services against the real behavioural fixtures, and prints the behavioural
 * index each one earns. No database and no Redis — the engine services are
 * pure, which is the whole reason they were built that way.
 *
 * It exists because "why does random answering still score 60%?" is the first
 * question anyone asks when they watch a demo, and the answer has to be a
 * measurement rather than an argument. A random responder should land on 50:
 * not a pass, not a fail, but the honest statement that the answers carried no
 * information about the candidate either way. Telling a random attempt apart
 * from a considered one is a separate job — see the response-validity work —
 * and this deliberately does not attempt it.
 *
 * Usage:  npx ts-node src/database/seeds/check-random-baseline.ts [runs]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AbilityEstimatorService } from '../../adaptive-engine/ability-estimator/ability-estimator.service';
import { EvaluationService } from '../../adaptive-engine/evaluation/evaluation.service';
import type { ModuleRunState } from '../../adaptive-engine/engine.types';
import { BehavioralPattern, ScoringType } from '../../common/enums';
import type {
  PersonalityOption,
  PersonalityQuestionDetails,
} from '../../question-bank/entities/personality-question-details.entity';
import type { Question } from '../../question-bank/entities/question.entity';
import { buildBehavioralProfiles } from '../../reports/behavioral-profiles';
import type { ReportedTrait } from '../../reports/report-builder';

const FIXTURES = join(
  __dirname,
  '..',
  '..',
  'question-bank',
  'bulk-import',
  'fixtures',
);
const FILES = [
  'personality-behavioral.csv',
  'personality-advanced.csv',
  'personality-probes.csv',
  'personality-probes-2.csv',
];

/** How many questions a personality section asks for — see `module-defaults`. */
const SECTION_LENGTH = 40;

const TRAITS = [
  'accountability',
  'adaptability',
  'communication',
  'empathy',
  'integrity',
  'leadership',
  'ownership',
  'resilience',
  'risk_tolerance',
  'teamwork',
];

const evaluation = new EvaluationService();
const estimator = new AbilityEstimatorService();

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The fixture bank as the engine sees it. */
function loadQuestions(): PersonalityQuestionDetails[] {
  const questions: PersonalityQuestionDetails[] = [];

  for (const file of FILES) {
    const path = join(FIXTURES, file);
    if (!existsSync(path)) continue;

    const rows = parseCsv(readFileSync(path, 'utf8'));
    const header = rows[0];
    const weightColumns = header
      .map((name, index) => ({ name, index }))
      .filter((column) => column.name.endsWith('_weights'));

    for (const row of rows.slice(1)) {
      if (row.length < header.length) continue;

      const options: PersonalityOption[] = [];
      weightColumns.forEach((column, position) => {
        const raw = row[column.index];
        if (!raw) return;

        const traitWeights: Record<string, number> = {};
        for (const pair of raw.split(';')) {
          const [trait, weight] = pair.split(':');
          if (trait) traitWeights[trait.trim()] = Number(weight);
        }
        options.push({
          key: String.fromCharCode(65 + position),
          text: '',
          traitWeights,
        });
      });
      if (options.length < 2) continue;

      const patternIndex = header.indexOf('pattern');
      const raw = patternIndex >= 0 ? row[patternIndex]?.trim() : '';
      questions.push({
        questionId: `fixture-${questions.length}`,
        question: undefined as unknown as Question,
        timesUsed: 0,
        pattern: (raw || null) as BehavioralPattern | null,
        options,
      });
    }
  }

  return questions;
}

function emptyState(): ModuleRunState {
  return {
    moduleId: 'm',
    organisationId: 'o',
    assessmentId: 'a',
    poolRestricted: false,
    slug: 'personality',
    name: 'Personality',
    description: null,
    scoringType: ScoringType.TRAIT,
    questionCount: SECTION_LENGTH,
    timeLimitSeconds: 1800,
    traits: TRAITS.map((key) => ({ key, label: key })),
    status: 'in_progress',
    startedAt: 0,
    deadlineAt: null,
    completedAt: null,
    stopReason: null,
    answered: 0,
    correct: 0,
    seenQuestionIds: [],
    ability: 0,
    information: 0,
    recentAbilities: [],
    traitTallies: {},
    patternCounts: {},
    probes: [],
    servedProbeGroups: [],
  };
}

type Strategy = 'random' | 'best' | 'worst';

/**
 * One simulated attempt.
 *
 * `useRanges` is the switch this whole script exists to demonstrate: with it
 * off the trait scores come out on the old fixed -3..+3 scale, with it on they
 * are measured against what the served questions actually made possible.
 */
function attempt(
  bank: PersonalityQuestionDetails[],
  strategy: Strategy,
  useRanges: boolean,
): number | null {
  const state = emptyState();

  for (let i = 0; i < SECTION_LENGTH; i += 1) {
    const details = bank[Math.floor(Math.random() * bank.length)];
    const isRanking = details.pattern === BehavioralPattern.RANKING;
    const keys = details.options.map((option) => option.key);

    // For 'best'/'worst', try every answer and keep the one with the highest
    // (or lowest) total weight — a candidate reading the desirable answer off
    // every question, which is the ceiling this scale should report near.
    const candidates = isRanking
      ? permutations(keys)
      : keys.map((key) => [key]);

    const scored = candidates.map((answer) => {
      const weights = isRanking
        ? evaluation.evaluateRanking(details, answer).traitWeights
        : evaluation.evaluatePersonality(details, answer[0]).traitWeights;
      return {
        answer,
        weights,
        total: Object.values(weights).reduce((sum, w) => sum + w, 0),
      };
    });

    const chosen =
      strategy === 'random'
        ? scored[Math.floor(Math.random() * scored.length)]
        : strategy === 'best'
          ? scored.reduce((a, b) => (b.total > a.total ? b : a))
          : scored.reduce((a, b) => (b.total < a.total ? b : a));

    estimator.applyTraitWeights(
      state.traitTallies,
      chosen.weights,
      useRanges
        ? evaluation.achievableTraitRange(details, isRanking)
        : undefined,
    );
    state.answered += 1;
  }

  const scores = estimator.traitScores(state);
  const traits: ReportedTrait[] = Object.entries(scores).map(
    ([key, score]) => ({
      key,
      label: key,
      score: score.score,
      confidence: score.confidence,
      consistency: score.consistency ?? null,
    }),
  );

  return buildBehavioralProfiles(traits).index;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((tail) => [
      item,
      ...tail,
    ]),
  );
}

function summarise(values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const at = (p: number) => sorted[Math.floor(sorted.length * p)].toFixed(0);
  return `${mean.toFixed(1).padStart(5)}  (${at(0.1)}-${at(0.9)})`.padEnd(22);
}

function main(): void {
  const runs = Number(process.argv[2] ?? 2000);
  const bank = loadQuestions();
  if (bank.length === 0) {
    console.error(`No behavioural fixtures found under ${FIXTURES}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nBehavioural index over ${runs} simulated attempts of ` +
      `${SECTION_LENGTH} questions, drawn from ${bank.length} fixture questions.\n`,
  );

  const strategies: [string, Strategy][] = [
    ['answering at random', 'random'],
    ['picking the most indicative answer every time', 'best'],
    ['picking the least indicative answer every time', 'worst'],
  ];

  console.log(
    `  ${''.padEnd(48)}${'fixed -3..+3 (before)'.padEnd(22)}per-item (after)`,
  );

  for (const [label, strategy] of strategies) {
    const before: number[] = [];
    const after: number[] = [];
    for (let i = 0; i < runs; i += 1) {
      const legacy = attempt(bank, strategy, false);
      const scaled = attempt(bank, strategy, true);
      if (legacy !== null) before.push(legacy);
      if (scaled !== null) after.push(scaled);
    }
    console.log(
      `  ${label.padEnd(48)}${summarise(before).padEnd(20)}${summarise(after)}`,
    );
  }

  console.log(
    '\n  50 is the target for a random attempt: the answers said nothing, and\n' +
      '  the score says nothing. Separating a random attempt from a considered\n' +
      '  one is the response-validity check, not this scale.\n',
  );
}

main();
