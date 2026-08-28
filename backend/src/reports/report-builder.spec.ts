import {
  HiringRecommendation,
  ProctoringEventType,
  ScoringType,
  SessionStatus,
} from '../common/enums';
import {
  buildReport,
  expectedCorrectByChance,
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
    // Ten four-option questions: two and a half right by guessing alone.
    expectedByChance: 2.5,
    questionCount: 8,
    traits: [],
    consistency: null,
    probes: null,
    legacyTraitModel: false,
    ...overrides,
  };
}

function traitModule(
  traits: {
    key: string;
    label: string;
    score: number;
    confidence: number;
    consistency?: number | null;
  }[],
  overrides: Partial<ModuleSummary> = {},
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
    // Null on a trait module: there is no right answer to guess at.
    expectedByChance: null,
    questionCount: 8,
    traits: traits.map((t) => ({ consistency: null, ...t })),
    consistency: null,
    probes: null,
    legacyTraitModel: false,
    ...overrides,
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

describe('expectedCorrectByChance', () => {
  it('counts a four-option question as a quarter of a right answer', () => {
    expect(expectedCorrectByChance([4, 4, 4, 4])).toBe(1);
    expect(expectedCorrectByChance(Array<number>(12).fill(4))).toBe(3);
  });

  it('sums per question rather than assuming the option floor', () => {
    // The bank allows four to six options. Six-option items are worth far less
    // to a guesser, and quoting a flat quarter would tell a recruiter that a
    // candidate did no better than chance when they plainly did.
    expect(expectedCorrectByChance([6, 6, 6])).toBe(0.5);
    expect(expectedCorrectByChance([4, 6])).toBe(0.4);
  });

  it('reports nothing rather than zero when no question could be read', () => {
    // Zero would be a claim — that every correct answer was earned. Null says
    // the chance level is unknown, which is what an unreadable question means.
    expect(expectedCorrectByChance([])).toBeNull();
    expect(expectedCorrectByChance([0, 0])).toBeNull();
  });

  it('ignores an unreadable question without penalising the rest', () => {
    expect(expectedCorrectByChance([4, 0, 4, 4, 4])).toBe(1);
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
    expect(report.abilityScore).toBeNull();
    expect(report.behavioralScore).toBeNull();
    expect(report.summary).toContain('no score to report');

    // Not `borderline`. That band is a finding — the evidence put them in the
    // middle — and there is no evidence here. Storing it made an unanswered
    // test indistinguishable, in a cohort list, from one somebody genuinely
    // scraped through, and those call for opposite next steps.
    expect(report.hiringRecommendation).toBeNull();
  });

  it('still bands a real middling score as borderline', () => {
    // The counterpart to the test above: `borderline` must keep meaning what it
    // always did, or withholding it on an empty attempt achieves nothing.
    const report = buildReport(input({ modules: [objectiveModule(50)] }));

    expect(report.overallScore).toBe(50);
    expect(report.hiringRecommendation).toBe(HiringRecommendation.BORDERLINE);
  });
});

/**
 * The composites are what a personality module produces for a recruiter. Before
 * they existed, a behaviour-only assessment reported a null score and a
 * permanent "borderline", which read as "no result" for a candidate whose ten
 * traits had all been measured.
 */
describe('buildReport — behavioural composites', () => {
  /** Every workplace trait at one level, so a composite's value is predictable. */
  const flatProfile = (score: number, confidence = 1) =>
    traitModule(
      [
        'leadership',
        'ownership',
        'accountability',
        'teamwork',
        'communication',
        'empathy',
        'integrity',
        'adaptability',
        'resilience',
        'risk_tolerance',
      ].map((key) => ({ key, label: key, score, confidence })),
    );

  it('scores a behaviour-only assessment instead of reporting nothing', () => {
    const report = buildReport(input({ modules: [flatProfile(80)] }));

    expect(report.abilityScore).toBeNull();
    expect(report.behavioralScore).toBe(80);
    // The behavioural half takes the full weight when there is no other half.
    expect(report.overallScore).toBe(80);
    expect(report.hiringRecommendation).toBe(
      HiringRecommendation.STRONGLY_RECOMMENDED,
    );
    expect(report.profiles).toHaveLength(5);
  });

  /*
   * A thin attempt must not produce a confident-looking profile.
   *
   * Both of these were live defects. A candidate who answered 3 of 5 personality
   * questions — leaving most traits with one answer and two with none at all —
   * was shown five composites with scores around 50 and bands reading
   * "Moderate", which is exactly what a recruiter acts on.
   */
  describe('when the evidence is thin', () => {
    it('keeps an unmeasured trait out of the blend entirely', () => {
      // The estimator reports every declared trait, scoring an unanswered one at
      // the neutral midpoint with confidence 0 so the report can say "no
      // signal". Letting that 50 into a composite fabricates the answer: here
      // teamwork carries 35% of Team Collaboration on no evidence at all.
      const module = traitModule([
        { key: 'teamwork', label: 'Teamwork', score: 50, confidence: 0 },
        { key: 'empathy', label: 'Empathy', score: 100, confidence: 1 },
        {
          key: 'communication',
          label: 'Communication',
          score: 100,
          confidence: 1,
        },
        { key: 'integrity', label: 'Integrity', score: 100, confidence: 1 },
      ]);

      const report = buildReport(input({ modules: [module] }));
      const collaboration = report.profiles.find(
        (p) => p.key === 'collaboration',
      )!;

      // Teamwork dropped, the other three renormalised — so 100, not the 82.5
      // that including a phantom 50 at 35% would produce.
      expect(collaboration.contributions.map((c) => c.key)).not.toContain(
        'teamwork',
      );
      expect(collaboration.score).toBe(100);
    });

    it('withholds the score and band when confidence is below the floor', () => {
      // One answer per trait: arithmetically fine, and meaningless. A number on
      // screen gets acted on whatever caveat sits beside it, so there is none.
      const report = buildReport({
        ...input({ modules: [flatProfile(50, 0.33)] }),
      });

      for (const profile of report.profiles) {
        expect(profile.score).toBeNull();
        expect(profile.band).toBeNull();
        // Still listed, and still showing its working — "we asked and got too
        // little back" is itself worth knowing.
        expect(profile.contributions.length).toBeGreaterThan(0);
      }

      // Nothing to build a headline on either.
      expect(report.behavioralScore).toBeNull();
    });

    it('drops a composite whose traits were none of them measured', () => {
      const module = traitModule([
        {
          key: 'adaptability',
          label: 'Adaptability',
          score: 50,
          confidence: 0,
        },
        { key: 'resilience', label: 'Resilience', score: 50, confidence: 0 },
        { key: 'risk_tolerance', label: 'Risk', score: 50, confidence: 0 },
        { key: 'ownership', label: 'Ownership', score: 50, confidence: 0 },
      ]);

      const report = buildReport(input({ modules: [module] }));

      // Every trait behind Adaptability Under Pressure is unmeasured, so there
      // is no composite to report — not a composite scoring 50.
      expect(
        report.profiles.find((p) => p.key === 'resilience_under_pressure'),
      ).toBeUndefined();
    });
  });

  it('blends ability and behaviour 70/30', () => {
    const report = buildReport(
      input({ modules: [objectiveModule(50), flatProfile(100)] }),
    );

    expect(report.abilityScore).toBe(50);
    expect(report.behavioralScore).toBe(100);
    expect(report.overallScore).toBe(65);
  });

  it('leaves an objective-only assessment exactly as it was', () => {
    const report = buildReport(input({ modules: [objectiveModule(64)] }));

    expect(report.behavioralScore).toBeNull();
    expect(report.overallScore).toBe(64);
    expect(report.profiles).toEqual([]);
  });

  it('renormalises over the traits that were actually measured', () => {
    // Collaboration is teamwork .35, empathy .3, communication .25,
    // integrity .1. With only teamwork and empathy present the two carry
    // .35/.65 and .3/.65 — a weighted mean of 90 and 20, not of 90, 20 and two
    // neutral 50s.
    const report = buildReport(
      input({
        modules: [
          traitModule([
            { key: 'teamwork', label: 'Teamwork', score: 90, confidence: 1 },
            { key: 'empathy', label: 'Empathy', score: 20, confidence: 1 },
          ]),
        ],
      }),
    );

    const collaboration = report.profiles.find(
      (p) => p.key === 'collaboration',
    );
    expect(collaboration?.score).toBe(57.7);
    expect(collaboration?.contributions.map((c) => c.weight)).toEqual([
      0.54, 0.46,
    ]);
  });

  it('excludes a thinly-evidenced composite from the index', () => {
    const report = buildReport(input({ modules: [flatProfile(80, 0.2)] }));

    // The composites are still reported — with their low confidence on show —
    // but none of them is firm enough to carry a headline number.
    expect(report.profiles).toHaveLength(5);
    expect(report.profiles.every((p) => p.confidence === 0.2)).toBe(true);
    expect(report.behavioralScore).toBeNull();
    expect(report.overallScore).toBeNull();
  });

  it('never lets one trait decide the recommendation', () => {
    const strongLeader = traitModule([
      { key: 'leadership', label: 'Leadership', score: 100, confidence: 1 },
    ]);
    const report = buildReport(input({ modules: [strongLeader] }));

    // Leadership is .35 of Leadership Readiness and nothing else. On its own it
    // renormalises to the whole of that one composite, which is the only one
    // built — so the index is that composite, not a profile-wide verdict.
    expect(report.profiles).toHaveLength(1);
    expect(report.profiles[0].key).toBe('leadership_readiness');
    expect(report.behavioralScore).toBe(100);
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
          objectiveModule(88, { questionsAnswered: 2, questionCount: 10 }),
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
          objectiveModule(15, { questionsAnswered: 2, questionCount: 10 }),
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
          objectiveModule(60, { questionsAnswered: 3, questionCount: 8 }),
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

  describe('behavioural consistency', () => {
    const behavioural = (consistency: number | null) =>
      traitModule(
        [{ key: 'teamwork', label: 'Teamwork', score: 70, confidence: 1 }],
        { consistency },
      );

    it('says nothing when no trait had enough evidence to measure', () => {
      const report = buildReport(
        input({ modules: [objectiveModule(70), behavioural(null)] }),
      );

      expect(report.summary).not.toMatch(/consisten|varied/i);
    });

    it('notes steady answers across situations', () => {
      const report = buildReport(
        input({ modules: [objectiveModule(70), behavioural(0.9)] }),
      );

      expect(report.summary).toContain('pointed the same way');
    });

    it('frames variation as evidence to read, never as dishonesty', () => {
      const report = buildReport(
        input({ modules: [objectiveModule(70), behavioural(0.2)] }),
      );

      expect(report.summary).toContain('varied noticeably');
      expect(report.summary).toContain(
        'read the question-by-question evidence',
      );
      // The wording must never imply the candidate was untruthful.
      expect(report.summary).not.toMatch(/dishonest|lying|untruthful|faking/i);
    });

    it('never lets consistency move the recommendation', () => {
      // Same objective score, opposite extremes of consistency.
      const steady = buildReport(
        input({ modules: [objectiveModule(80), behavioural(1)] }),
      );
      const varied = buildReport(
        input({ modules: [objectiveModule(80), behavioural(0)] }),
      );

      expect(varied.hiringRecommendation).toBe(steady.hiringRecommendation);
      expect(varied.overallScore).toBe(steady.overallScore);
    });
  });
});
