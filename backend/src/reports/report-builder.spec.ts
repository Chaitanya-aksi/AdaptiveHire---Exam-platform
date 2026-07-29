import {
  HiringRecommendation,
  ProctoringEventType,
  ScoringType,
  SessionStatus,
} from '../common/enums';
import {
  buildReport,
  normaliseAbility,
  type ModuleSummary,
  type ReportInput,
} from './report-builder';
import { ABILITY_CEILING, ABILITY_FLOOR } from './report.constants';

function objectiveModule(
  score: number,
  overrides: Partial<ModuleSummary> = {},
): ModuleSummary {
  return {
    moduleId: `m-${score}`,
    name: 'Aptitude',
    slug: 'aptitude',
    scoringType: ScoringType.OBJECTIVE,
    abilityScore: 1000,
    score,
    questionsAnswered: 10,
    questionsCorrect: 6,
    minQuestions: 8,
    traits: [],
    ...overrides,
  };
}

function traitModule(
  traits: { key: string; label: string; score: number; confidence: number }[],
): ModuleSummary {
  return {
    moduleId: 'm-personality',
    name: 'Personality',
    slug: 'personality',
    scoringType: ScoringType.TRAIT,
    abilityScore: null,
    score: null,
    questionsAnswered: 12,
    questionsCorrect: 0,
    minQuestions: 8,
    traits,
  };
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    candidateName: 'Alex Doe',
    assessmentTitle: 'Graduate Screen',
    sessionStatus: SessionStatus.COMPLETED,
    modules: [objectiveModule(70)],
    violations: [],
    ...overrides,
  };
}

describe('normaliseAbility', () => {
  it('maps the question bank range onto 0-100', () => {
    expect(normaliseAbility(ABILITY_FLOOR)).toBe(0);
    expect(normaliseAbility(ABILITY_CEILING)).toBe(100);
    expect(normaliseAbility((ABILITY_FLOOR + ABILITY_CEILING) / 2)).toBe(50);
  });

  it('clamps rather than reporting an impossible score', () => {
    expect(normaliseAbility(200)).toBe(0);
    expect(normaliseAbility(2000)).toBe(100);
  });
});

describe('buildReport — overall score', () => {
  it('averages the objective modules and ignores trait ones', () => {
    const report = buildReport(
      input({
        modules: [
          objectiveModule(80),
          objectiveModule(60, { moduleId: 'm-logic', name: 'Logical' }),
          traitModule([
            {
              key: 'openness',
              label: 'Adaptability',
              score: 90,
              confidence: 1,
            },
          ]),
        ],
      }),
    );

    expect(report.overallScore).toBe(70);
  });

  it('ignores a module the candidate never reached', () => {
    const report = buildReport(
      input({
        modules: [
          objectiveModule(80),
          objectiveModule(0, {
            moduleId: 'm-unreached',
            name: 'Verbal',
            score: null,
            abilityScore: null,
            questionsAnswered: 0,
            questionsCorrect: 0,
          }),
        ],
      }),
    );

    expect(report.overallScore).toBe(80);
  });

  it('reports no score at all when nothing scored was answered', () => {
    const report = buildReport(
      input({
        modules: [
          objectiveModule(0, {
            score: null,
            abilityScore: null,
            questionsAnswered: 0,
          }),
        ],
      }),
    );

    expect(report.overallScore).toBeNull();
    expect(report.summary).toContain('no ability score to report');
  });
});

describe('buildReport — recommendation', () => {
  const at = (score: number) =>
    buildReport(input({ modules: [objectiveModule(score)] }))
      .hiringRecommendation;

  it('bands on the overall score', () => {
    expect(at(88)).toBe(HiringRecommendation.STRONGLY_RECOMMENDED);
    expect(at(60)).toBe(HiringRecommendation.RECOMMENDED);
    expect(at(45)).toBe(HiringRecommendation.BORDERLINE);
    expect(at(20)).toBe(HiringRecommendation.NOT_RECOMMENDED);
  });

  it('never lets proctoring violations change it', () => {
    const clean = buildReport(input({ modules: [objectiveModule(88)] }));
    const flagged = buildReport(
      input({
        modules: [objectiveModule(88)],
        violations: [
          { eventType: ProctoringEventType.TAB_SWITCH, count: 9 },
          { eventType: ProctoringEventType.MULTIPLE_FACES, count: 4 },
        ],
      }),
    );

    expect(flagged.hiringRecommendation).toBe(clean.hiringRecommendation);
    expect(flagged.summary).toContain('signals, not conclusions');
  });

  it('caps a strong result that rests on too few answers', () => {
    const thin = buildReport(
      input({
        modules: [
          objectiveModule(88, { questionsAnswered: 2, minQuestions: 10 }),
        ],
      }),
    );

    expect(thin.hiringRecommendation).toBe(HiringRecommendation.BORDERLINE);
    expect(thin.summary).toContain('less evidence than intended');
  });

  it('does not let thin evidence rescue a poor result', () => {
    const thin = buildReport(
      input({
        modules: [
          objectiveModule(15, { questionsAnswered: 2, minQuestions: 10 }),
        ],
      }),
    );

    expect(thin.hiringRecommendation).toBe(
      HiringRecommendation.NOT_RECOMMENDED,
    );
  });
});

describe('buildReport — strengths and weaknesses', () => {
  it('names a strong module and a weak one', () => {
    const report = buildReport(
      input({
        modules: [
          objectiveModule(82),
          objectiveModule(20, { moduleId: 'm-logic', name: 'Logical' }),
        ],
      }),
    );

    expect(report.strengths).toContain('Aptitude — scored 82/100');
    expect(report.weaknesses).toContain('Logical — scored 20/100');
  });

  it('uses recruiter-facing trait labels, never engine keys', () => {
    const report = buildReport(
      input({
        modules: [
          traitModule([
            {
              key: 'conscientiousness',
              label: 'Reliability & Follow-Through',
              score: 90,
              confidence: 1,
            },
          ]),
        ],
      }),
    );

    expect(report.strengths).toContain('Reliability & Follow-Through — 90/100');
    expect(JSON.stringify(report)).not.toContain('conscientiousness');
  });

  it('will not call a barely-measured trait a strength', () => {
    const report = buildReport(
      input({
        modules: [
          traitModule([
            {
              key: 'openness',
              label: 'Adaptability',
              score: 95,
              confidence: 0.33,
            },
          ]),
        ],
      }),
    );

    expect(report.strengths).toHaveLength(0);
    expect(report.weaknesses).toHaveLength(0);
  });

  it('flags a section the candidate under-answered', () => {
    const report = buildReport(
      input({
        modules: [
          objectiveModule(60, { questionsAnswered: 3, minQuestions: 8 }),
        ],
      }),
    );

    expect(report.weaknesses).toContain(
      'Aptitude — answered only 3 of the 8 questions this section asks for',
    );
  });
});

describe('buildReport — narrative', () => {
  it('says so when nothing was flagged', () => {
    expect(buildReport(input()).summary).toContain(
      'No proctoring signals were recorded',
    );
  });

  it('pluralises violation counts correctly', () => {
    const report = buildReport(
      input({
        violations: [
          { eventType: ProctoringEventType.TAB_SWITCH, count: 1 },
          { eventType: ProctoringEventType.FULLSCREEN_EXIT, count: 3 },
        ],
      }),
    );

    expect(report.summary).toContain('1 tab switch,');
    expect(report.summary).toContain('3 full-screen exits');
  });

  it('notes when the attempt was cut off by the clock', () => {
    const report = buildReport(
      input({ sessionStatus: SessionStatus.AUTO_SUBMITTED }),
    );

    expect(report.summary).toContain('submitted automatically');
  });

  it('contrasts the strongest and weakest sections', () => {
    const report = buildReport(
      input({
        modules: [
          objectiveModule(85),
          objectiveModule(40, { moduleId: 'm-logic', name: 'Logical' }),
        ],
      }),
    );

    expect(report.summary).toContain('Strongest section was Aptitude (85/100)');
    expect(report.summary).toContain('weakest was Logical (40/100)');
  });
});
