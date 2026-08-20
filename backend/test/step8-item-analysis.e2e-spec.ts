import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, http, uniqueEmail } from './helpers';
import { E2E_ORG_PREFIX } from './e2e.constants';
import { MIN_ATTEMPTS } from '../src/question-bank/item-analysis.service';

/**
 * Classical item analysis.
 *
 * The statistics here can be silently wrong in a way that matters: a
 * discrimination coefficient with its sign flipped would tell a recruiter to
 * retire the questions that work and keep the ones scoring good candidates
 * down. So this suite builds answer patterns whose correct answers are known by
 * construction, and checks the numbers that come back.
 */

const PASSWORD = 'ItemAnalysis!2345';

interface Analysis {
  questionId: string;
  attempts: number;
  pValue: number | null;
  discrimination: number | null;
  drift: number | null;
  options: { key: string; isCorrect: boolean; pickRate: number }[];
  flags: string[];
}

describe('Step 8 — Item analysis', () => {
  let app: INestApplication;
  let ds: DataSource;

  let token: string;
  let moduleId: string;
  let assessmentId: string;
  let candidateId: string;

  /** Answered right by strong candidates and wrong by weak ones — a good item. */
  let discriminatingId: string;
  /** Answered right by weak candidates and wrong by strong ones — mis-keyed. */
  let reversedId: string;
  /** Everyone gets it right. */
  let tooEasyId: string;
  /** Barely attempted. */
  let untestedId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function makeQuestion(text: string): Promise<string> {
    const res = await http(app)
      .post('/api/questions')
      .set(auth())
      .send({
        moduleId,
        questionText: text,
        tags: ['e2e'],
        status: 'active',
        mcq: {
          options: [
            { key: 'A', text: 'a' },
            { key: 'B', text: 'b' },
            { key: 'C', text: 'c' },
            { key: 'D', text: 'd' },
          ],
          correctOption: 'B',
          difficultyScore: 1000,
        },
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  /**
   * One submitted attempt at a known ability, answering the given questions
   * with the given outcomes.
   *
   * Written directly rather than sat, because the point is to control the
   * ability/outcome pairing exactly — running the adaptive engine would give
   * realistic data and no way to assert against it.
   */
  async function attempt(
    ability: number,
    answers: { questionId: string; correct: boolean; picked: string }[],
  ) {
    const invite = await ds.query<{ id: string }[]>(
      `INSERT INTO invitations ("assessmentId", email, status, "candidateId")
       VALUES ($1, $2, 'completed', $3) RETURNING id`,
      [assessmentId, uniqueEmail('ia'), candidateId],
    );
    const session = await ds.query<{ id: string }[]>(
      `INSERT INTO assessment_sessions
         ("invitationId","assessmentId","candidateId",status,"startedAt","expiresAt","submittedAt")
       VALUES ($1,$2,$3,'completed',now(),now()+interval '1 hour',now())
       RETURNING id`,
      [invite[0].id, assessmentId, candidateId],
    );
    await ds.query(
      `INSERT INTO session_module_results
         ("sessionId","moduleId","abilityScore","questionsAnswered","questionsCorrect")
       VALUES ($1,$2,$3,$4,$5)`,
      [
        session[0].id,
        moduleId,
        ability,
        answers.length,
        answers.filter((a) => a.correct).length,
      ],
    );

    let seq = 1;
    for (const answer of answers) {
      await ds.query(
        `INSERT INTO responses
           ("sessionId","moduleId","questionId","selectedOption","isCorrect","sequenceNumber")
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          session[0].id,
          moduleId,
          answer.questionId,
          answer.picked,
          answer.correct,
          seq++,
        ],
      );
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);

    const registered = await http(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail('itemanalysis'),
        password: PASSWORD,
        fullName: 'Item Analysis Owner',
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}itemanalysis ${Date.now()}`,
      })
      .expect(201);
    token = (registered.body as { accessToken: string }).accessToken;

    const modules = await http(app).get('/api/modules').set(auth()).expect(200);
    moduleId = (modules.body as { id: string; slug: string }[]).find(
      (m) => m.slug === 'aptitude',
    )!.id;

    const assessment = await http(app)
      .post('/api/assessments')
      .set(auth())
      .send({
        title: 'Item analysis assessment',
        modules: [
          { moduleId, minQuestions: 1, maxQuestions: 5, timeLimitSeconds: 600 },
        ],
      })
      .expect(201);
    assessmentId = (assessment.body as { id: string }).id;

    const candidate = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, "passwordHash", "fullName", role)
       VALUES ($1, 'x', 'IA Candidate', 'candidate') RETURNING id`,
      [uniqueEmail('ia-owner')],
    );
    candidateId = candidate[0].id;

    discriminatingId = await makeQuestion('E2E discriminating item');
    reversedId = await makeQuestion('E2E reversed item');
    tooEasyId = await makeQuestion('E2E too easy item');
    untestedId = await makeQuestion('E2E barely attempted item');

    // Half strong, half weak, comfortably over the reporting floor.
    const half = MIN_ATTEMPTS;
    for (let i = 0; i < half; i++) {
      await attempt(1400, [
        { questionId: discriminatingId, correct: true, picked: 'B' },
        { questionId: reversedId, correct: false, picked: 'A' },
        { questionId: tooEasyId, correct: true, picked: 'B' },
      ]);
      await attempt(700, [
        { questionId: discriminatingId, correct: false, picked: 'A' },
        { questionId: reversedId, correct: true, picked: 'B' },
        { questionId: tooEasyId, correct: true, picked: 'B' },
      ]);
    }

    // One lonely attempt, so this question stays under the floor.
    await attempt(1000, [
      { questionId: untestedId, correct: true, picked: 'B' },
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function analysisFor(questionId: string): Promise<Analysis> {
    const res = await http(app)
      .get('/api/questions/analysis')
      .set(auth())
      .expect(200);

    const found = (res.body as Analysis[]).find(
      (row) => row.questionId === questionId,
    );
    expect(found).toBeDefined();
    return found!;
  }

  it('scores a question that separates strong from weak candidates positively', async () => {
    const item = await analysisFor(discriminatingId);

    expect(item.attempts).toBeGreaterThanOrEqual(MIN_ATTEMPTS);
    // Every strong candidate right, every weak one wrong: as clean a positive
    // correlation as the data can produce.
    expect(item.discrimination).toBeGreaterThan(0.9);
    expect(item.pValue).toBeCloseTo(0.5, 1);
    expect(item.flags).not.toContain('negative_discrimination');
  });

  it('catches a mis-keyed question that scores good candidates down', async () => {
    const item = await analysisFor(reversedId);

    // The single most damaging thing a bank can contain, and invisible in
    // `timesCorrect` alone: the pass rate here is identical to the good item's.
    expect(item.discrimination).toBeLessThan(0);
    expect(item.flags).toContain('negative_discrimination');
    expect(item.flags).not.toContain('weak_discrimination');
  });

  it('flags a question everybody gets right', async () => {
    const item = await analysisFor(tooEasyId);

    expect(item.pValue).toBe(1);
    expect(item.flags).toContain('too_easy');
  });

  it('reports per-option pick rates', async () => {
    const item = await analysisFor(discriminatingId);

    const picked = item.options.filter((o) => o.pickRate > 0);
    // Only A and B were ever chosen, so C and D are dead distractors.
    expect(picked.map((o) => o.key).sort()).toEqual(['A', 'B']);
    expect(item.flags).toContain('dead_distractor');

    const total = item.options.reduce((sum, o) => sum + o.pickRate, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('publishes nothing but a warning below the attempt floor', async () => {
    const item = await analysisFor(untestedId);

    // A discrimination coefficient from one attempt is noise, and flagging it
    // would send a recruiter to retire a question nobody has tried.
    expect(item.flags).toEqual(['insufficient_data']);
    expect(item.pValue).toBeNull();
    expect(item.discrimination).toBeNull();
    expect(item.drift).toBeNull();
  });

  it('reports difficulty drift against what was authored', async () => {
    const item = await analysisFor(tooEasyId);

    // Authored at 1000 but passed by everyone, including candidates well below
    // that: observed difficulty is far lower than claimed.
    expect(item.drift).not.toBeNull();
    expect(item.drift!).toBeLessThan(0);
    expect(item.flags).toContain('difficulty_drift');
  });

  it('does not expose another organisation’s questions', async () => {
    const other = await http(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail('ia-other'),
        password: PASSWORD,
        fullName: 'Other Org',
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}ia-other ${Date.now()}`,
      })
      .expect(201);

    const res = await http(app)
      .get('/api/questions/analysis')
      .set({
        Authorization: `Bearer ${(other.body as { accessToken: string }).accessToken}`,
      })
      .expect(200);

    const ids = (res.body as Analysis[]).map((row) => row.questionId);
    expect(ids).not.toContain(discriminatingId);
  });
});
