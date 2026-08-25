import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  SEEDED_CANDIDATE,
  SEEDED_RECRUITER,
  createTestApp,
  http,
  loginSeeded,
} from './helpers';

interface ModuleRow {
  id: string;
  slug: string;
  scoringType: string;
  traits: { key: string; label: string; invertForReport?: boolean }[] | null;
}

/**
 * Acceptance checks for Step 2 (Question Bank): the module catalogue, question
 * CRUD, and bulk import. Assumes `npm run seed` has been run.
 */
describe('Step 2 — Question Bank', () => {
  let app: INestApplication;
  let recruiterToken: string;
  let candidateToken: string;
  let modules: ModuleRow[];
  const createdQuestionIds: string[] = [];

  const auth = () => ({ Authorization: `Bearer ${recruiterToken}` });
  const moduleBySlug = (slug: string): ModuleRow => {
    const found = modules.find((m) => m.slug === slug);
    if (!found)
      throw new Error(`Module "${slug}" missing — run \`npm run seed\``);
    return found;
  };

  beforeAll(async () => {
    app = await createTestApp();
    recruiterToken = await loginSeeded(app, SEEDED_RECRUITER);
    candidateToken = await loginSeeded(app, SEEDED_CANDIDATE);

    const res = await http(app).get('/api/modules').set(auth()).expect(200);
    modules = res.body as ModuleRow[];
  });

  afterAll(async () => {
    // Remove only what this suite created.
    if (createdQuestionIds.length > 0) {
      await app
        .get(DataSource)
        .query('DELETE FROM questions WHERE id = ANY($1)', [
          createdQuestionIds,
        ]);
    }
    await app?.close();
  });

  describe('module catalogue', () => {
    it('has the seeded objective modules', () => {
      for (const slug of ['aptitude', 'logical-reasoning', 'verbal-ability']) {
        expect(moduleBySlug(slug).scoringType).toBe('objective');
      }
    });

    it('has a trait module declaring the ten workplace traits with labels', () => {
      const personality = moduleBySlug('personality');
      expect(personality.scoringType).toBe('trait');

      const keys = (personality.traits ?? []).map((t) => t.key).sort();
      expect(keys).toEqual([
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
      ]);

      for (const trait of personality.traits ?? []) {
        expect(trait.label).toEqual(expect.any(String));
        expect(trait.label.length).toBeGreaterThan(0);
      }
    });

    it('declares every trait key exactly once', () => {
      // Two entries sharing a key would silently merge into one score, and the
      // second label would never be shown — the sort of thing a hand-edited
      // vocabulary migration gets wrong without failing anything else.
      const keys = (moduleBySlug('personality').traits ?? []).map((t) => t.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('refuses to give an objective module traits', async () => {
      await http(app)
        .post('/api/modules')
        .set(auth())
        .send({
          name: 'E2E Bad Objective',
          slug: 'e2e-bad-objective',
          scoringType: 'objective',
          traits: [{ key: 'conscientiousness', label: 'Reliability' }],
        })
        .expect(400);
    });

    it('refuses to create a trait module with no traits', async () => {
      await http(app)
        .post('/api/modules')
        .set(auth())
        .send({
          name: 'E2E Bad Trait',
          slug: 'e2e-bad-trait',
          scoringType: 'trait',
        })
        .expect(400);
    });

    it('rejects a duplicate slug with 409', async () => {
      await http(app)
        .post('/api/modules')
        .set(auth())
        .send({
          name: 'E2E Duplicate',
          slug: 'aptitude',
          scoringType: 'objective',
        })
        .expect(409);
    });
  });

  describe('question pool', () => {
    it('holds active questions for every objective module', async () => {
      for (const slug of ['aptitude', 'logical-reasoning', 'verbal-ability']) {
        const res = await http(app)
          .get('/api/questions')
          .query({
            moduleId: moduleBySlug(slug).id,
            status: 'active',
            limit: 1,
          })
          .set(auth())
          .expect(200);

        expect((res.body as { total: number }).total).toBeGreaterThan(0);
      }
    });

    /**
     * The adaptive engine picks the closest difficulty match to a candidate's
     * running ability. A pool clustered at one difficulty would make it
     * degenerate into a fixed test, so spread is a correctness requirement.
     */
    it('spans a usable difficulty range', async () => {
      const [{ min, max, spread }] = await app.get(DataSource).query<
        { min: number; max: number; spread: number }[]
      >(`SELECT min("difficultyScore")::int AS min,
                max("difficultyScore")::int AS max,
                count(DISTINCT "difficultyScore")::int AS spread
         FROM mcq_question_details`);

      expect(max - min).toBeGreaterThanOrEqual(300);
      expect(spread).toBeGreaterThanOrEqual(5);
    });

    it('covers every declared trait in the personality module', async () => {
      const rows = await app.get(DataSource).query<{ trait: string }[]>(
        `SELECT DISTINCT trait
           FROM personality_question_details p
           CROSS JOIN LATERAL jsonb_array_elements(p.options) AS o
           CROSS JOIN LATERAL jsonb_object_keys(o->'traitWeights') AS trait`,
      );
      const covered = rows.map((r) => r.trait);

      for (const trait of moduleBySlug('personality').traits ?? []) {
        expect(covered).toContain(trait.key);
      }
    });

    it('never exposes the question bank to a candidate', async () => {
      // mcq_question_details carries correctOption — a leak here is a cheat.
      await http(app)
        .get('/api/questions')
        .set('Authorization', `Bearer ${candidateToken}`)
        .expect(403);
    });
  });

  describe('question creation rules', () => {
    const aptitudeQuestion = (overrides: Record<string, unknown> = {}) => ({
      moduleId: moduleBySlug('aptitude').id,
      questionText: 'E2E: what is 6 x 7?',
      tags: ['e2e'],
      mcq: {
        options: [
          { key: 'A', text: '36' },
          { key: 'B', text: '42' },
          { key: 'C', text: '48' },
          { key: 'D', text: '54' },
        ],
        correctOption: 'B',
        difficultyScore: 900,
      },
      ...overrides,
    });

    it('creates as draft, then activates and archives', async () => {
      const created = await http(app)
        .post('/api/questions')
        .set(auth())
        .send(aptitudeQuestion())
        .expect(201);

      const { id, status } = created.body as { id: string; status: string };
      createdQuestionIds.push(id);
      expect(status).toBe('draft');

      const activated = await http(app)
        .patch(`/api/questions/${id}/activate`)
        .set(auth())
        .expect(200);
      expect((activated.body as { status: string }).status).toBe('active');

      const archived = await http(app)
        .patch(`/api/questions/${id}/archive`)
        .set(auth())
        .expect(200);
      expect((archived.body as { status: string }).status).toBe('archived');
    });

    /*
     * Practice questions, and the one property that makes them safe.
     *
     * The candidate is shown the answer before the assessment starts. If such a
     * question could then be asked for real, practice would be a leak of the
     * paper rather than a rehearsal of the controls — so the exclusion is the
     * feature, and these are the tests that hold it in place.
     */
    describe('sample questions', () => {
      it('records the flag and keeps it through an edit', async () => {
        const created = await http(app)
          .post('/api/questions')
          .set(auth())
          .send(aptitudeQuestion({ isSample: true }))
          .expect(201);

        const { id } = created.body as { id: string };
        createdQuestionIds.push(id);
        expect((created.body as { isSample: boolean }).isSample).toBe(true);

        // An unrelated edit must not quietly put it back into circulation.
        const edited = await http(app)
          .patch(`/api/questions/${id}`)
          .set(auth())
          .send({ questionText: 'E2E: what is 6 x 7, reworded?' })
          .expect(200);
        expect((edited.body as { isSample: boolean }).isSample).toBe(true);
      });

      it('refuses to put one in an assessment’s question pool', async () => {
        const sample = await http(app)
          .post('/api/questions')
          .set(auth())
          .send(aptitudeQuestion({ isSample: true, status: 'active' }))
          .expect(201);
        const sampleId = (sample.body as { id: string }).id;
        createdQuestionIds.push(sampleId);

        const res = await http(app)
          .post('/api/assessments')
          .set(auth())
          .send({
            title: 'E2E sample-pool assessment',
            modules: [
              {
                moduleId: moduleBySlug('aptitude').id,
                questionCount: 3,
                timeLimitSeconds: 600,
              },
            ],
            questionIds: [sampleId],
          })
          .expect(400);

        // Named as the fixable mistake it is, not as a missing id — the
        // question is theirs and visible, it just cannot be asked for real.
        expect(JSON.stringify(res.body)).toContain('practice question');
      });

      it('stays visible in the bank, so it can be reviewed', async () => {
        // The exclusion is from *serving*, not from the recruiter's own
        // listing. Hiding samples from the bank would leave nobody able to
        // find, edit or retire the questions candidates practise on.
        const sample = await http(app)
          .post('/api/questions')
          .set(auth())
          .send(aptitudeQuestion({ isSample: true, status: 'active' }))
          .expect(201);
        const sampleId = (sample.body as { id: string }).id;
        createdQuestionIds.push(sampleId);

        const listed = await http(app)
          .get('/api/questions?limit=200')
          .set(auth())
          .expect(200);

        const found = (listed.body as { items: { id: string }[] }).items.find(
          (q) => q.id === sampleId,
        );
        expect(found).toBeDefined();
      });
    });

    it('permanently deletes a question no candidate has answered', async () => {
      const created = await http(app)
        .post('/api/questions')
        .set(auth())
        .send(aptitudeQuestion())
        .expect(201);

      const { id } = created.body as { id: string };

      const deleted = await http(app)
        .delete(`/api/questions/${id}`)
        .set(auth())
        .expect(200);
      expect((deleted.body as { deleted: boolean }).deleted).toBe(true);

      // Gone for good — the row and its detail row are both removed.
      await http(app).get(`/api/questions/${id}`).set(auth()).expect(404);
    });

    it('rejects a correctOption that is not one of the option keys', async () => {
      await http(app)
        .post('/api/questions')
        .set(auth())
        .send(
          aptitudeQuestion({
            mcq: {
              options: [
                { key: 'A', text: '1' },
                { key: 'B', text: '2' },
                { key: 'C', text: '3' },
                { key: 'D', text: '4' },
              ],
              correctOption: 'Z',
            },
          }),
        )
        .expect(400);
    });

    /**
     * Four is the floor everywhere: it caps the objective guess rate at 25%
     * and keeps trait scales free of a neutral midpoint.
     */
    it('rejects a question with only three options', async () => {
      await http(app)
        .post('/api/questions')
        .set(auth())
        .send(
          aptitudeQuestion({
            mcq: {
              options: [
                { key: 'A', text: '1' },
                { key: 'B', text: '2' },
                { key: 'C', text: '3' },
              ],
              correctOption: 'B',
            },
          }),
        )
        .expect(400);
    });

    it('rejects a personality payload sent to an objective module', async () => {
      await http(app)
        .post('/api/questions')
        .set(auth())
        .send({
          moduleId: moduleBySlug('aptitude').id,
          questionText: 'E2E mismatch',
          personality: {
            // A valid pattern and real trait keys throughout, so the 400 can
            // only be the module/payload mismatch this test is named for.
            // Without the pattern it still returned 400 — for the missing
            // pattern instead, which is not what is under test.
            pattern: 'situational',
            options: [
              { key: 'A', text: 'w', traitWeights: { teamwork: 2 } },
              { key: 'B', text: 'x', traitWeights: { teamwork: 1 } },
              { key: 'C', text: 'y', traitWeights: { teamwork: -1 } },
              { key: 'D', text: 'z', traitWeights: { teamwork: -2 } },
            ],
          },
        })
        .expect(400);
    });

    it('rejects trait weights referencing an undeclared trait', async () => {
      const res = await http(app)
        .post('/api/questions')
        .set(auth())
        .send({
          moduleId: moduleBySlug('personality').id,
          questionText: 'E2E undeclared trait',
          personality: {
            // Everything valid except the one bogus key — otherwise the request
            // is rejected before trait validation is ever reached, and the test
            // passes without exercising the rule it names.
            pattern: 'situational',
            options: [
              {
                key: 'A',
                text: 'Strongly agree',
                traitWeights: { punctuality: 2 },
              },
              { key: 'B', text: 'Agree', traitWeights: { teamwork: 1 } },
              { key: 'C', text: 'Disagree', traitWeights: { teamwork: -1 } },
              {
                key: 'D',
                text: 'Strongly disagree',
                traitWeights: { teamwork: -2 },
              },
            ],
          },
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('punctuality');
    });
  });

  describe('bulk import', () => {
    const csv = (body: string) => Buffer.from(body, 'utf8');

    it('imports good rows and reports bad ones by spreadsheet row number', async () => {
      const file = csv(
        [
          'module_slug,question_text,option_a,option_b,option_c,option_d,correct_option,difficulty_score,tags',
          'aptitude,"E2E: what is 11 x 11?",111,121,131,141,B,800,e2e-import',
          'aptitude,"E2E: missing correct option",1,2,3,4,,800,e2e-import',
          'no-such-module,"E2E: bad slug",1,2,3,4,A,800,e2e-import',
        ].join('\n'),
      );

      const res = await http(app)
        .post('/api/questions/bulk-import')
        .set(auth())
        .attach('file', file, 'questions.csv')
        .expect(201);

      const result = res.body as {
        totalRows: number;
        imported: number;
        failed: number;
        importedAs: string;
        failures: { row: number; reason: string }[];
      };

      expect(result.totalRows).toBe(3);
      expect(result.imported).toBe(1);
      expect(result.failed).toBe(2);
      // Imports land as draft for review, never straight to active.
      expect(result.importedAs).toBe('draft');

      // Row numbers must match what the user sees in their spreadsheet.
      expect(result.failures.map((f) => f.row)).toEqual([3, 4]);
      expect(result.failures[1].reason).toContain('no-such-module');

      const ids = await app
        .get(DataSource)
        .query<{ id: string }[]>(
          "SELECT id FROM questions WHERE 'e2e-import' = ANY(tags)",
        );
      createdQuestionIds.push(...ids.map((r) => r.id));
    });

    it('rejects a file type it cannot parse', async () => {
      await http(app)
        .post('/api/questions/bulk-import')
        .set(auth())
        .attach('file', csv('%PDF-1.4'), 'notes.pdf')
        .expect(400);
    });

    it('blocks a candidate from importing', async () => {
      await http(app)
        .post('/api/questions/bulk-import')
        .set('Authorization', `Bearer ${candidateToken}`)
        .attach('file', csv('module_slug\naptitude'), 'questions.csv')
        .expect(403);
    });

    it('serves both downloadable templates', async () => {
      for (const kind of ['mcq', 'personality']) {
        const res = await http(app)
          .get(`/api/questions/bulk-import/template/${kind}`)
          .set(auth())
          .expect(200);

        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.text).toContain('module_slug');
      }
    });
  });
});
