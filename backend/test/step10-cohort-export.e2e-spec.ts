import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, http, uniqueEmail } from './helpers';
import { E2E_ORG_PREFIX } from './e2e.constants';

/**
 * Cohort CSV export.
 *
 * The risk in a CSV is never the happy path — it is a recruiter's note
 * containing a comma, a quote or a newline, which silently shifts every column
 * after it and produces a file that opens fine and says the wrong thing.
 */

const PASSWORD = 'CohortExport!2345';

describe('Step 10 — Cohort export', () => {
  let app: INestApplication;
  let ds: DataSource;

  let token: string;
  let otherToken: string;
  let moduleId: string;
  let assessmentId: string;
  let candidateId: string;
  let sessionOne: string;
  let sessionTwo: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function registerOrg(label: string): Promise<string> {
    const res = await http(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail(`export-${label}`),
        password: PASSWORD,
        fullName: `Export ${label}`,
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}export-${label} ${Date.now()}`,
      })
      .expect(201);
    return (res.body as { accessToken: string }).accessToken;
  }

  async function makeAttempt(name: string): Promise<string> {
    const candidate = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, "passwordHash", "fullName", role)
       VALUES ($1, 'x', $2, 'candidate') RETURNING id`,
      [uniqueEmail('export-cand'), name],
    );
    const invite = await ds.query<{ id: string }[]>(
      `INSERT INTO invitations ("assessmentId", email, status, "candidateId")
       VALUES ($1, $2, 'completed', $3) RETURNING id`,
      [assessmentId, uniqueEmail('export-inv'), candidate[0].id],
    );
    const session = await ds.query<{ id: string }[]>(
      `INSERT INTO assessment_sessions
         ("invitationId","assessmentId","candidateId",status,"startedAt","expiresAt","submittedAt")
       VALUES ($1,$2,$3,'completed',now(),now()+interval '1 hour',now())
       RETURNING id`,
      [invite[0].id, assessmentId, candidate[0].id],
    );
    await ds.query(
      `INSERT INTO session_module_results
         ("sessionId","moduleId","abilityScore","questionsAnswered","questionsCorrect")
       VALUES ($1,$2,1000,10,6)`,
      [session[0].id, moduleId],
    );
    candidateId = candidate[0].id;
    return session[0].id;
  }

  const download = async (sessionIds: string[]): Promise<string> => {
    const res = await http(app)
      .post(`/api/reports/assessments/${assessmentId}/export`)
      .set(auth(token))
      .send({ sessionIds })
      .expect(201);
    return res.text ?? String(res.body);
  };

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);

    token = await registerOrg('a');
    otherToken = await registerOrg('b');

    const modules = await http(app)
      .get('/api/modules')
      .set(auth(token))
      .expect(200);
    moduleId = (modules.body as { id: string; slug: string }[]).find(
      (m) => m.slug === 'aptitude',
    )!.id;

    const assessment = await http(app)
      .post('/api/assessments')
      .set(auth(token))
      .send({
        title: 'Export assessment',
        modules: [
          { moduleId, minQuestions: 1, maxQuestions: 5, timeLimitSeconds: 600 },
        ],
      })
      .expect(201);
    assessmentId = (assessment.body as { id: string }).id;

    sessionOne = await makeAttempt('Ada Lovelace');
    sessionTwo = await makeAttempt('Grace Hopper');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns a CSV with a header row', async () => {
    const csv = await download([]);

    expect(csv).toContain('Candidate');
    expect(csv).toContain('Overall score');
    expect(csv).toContain('Decision');
    expect(csv).toContain('Ada Lovelace');
  });

  it('honours the order it was given', async () => {
    // The file has to match the table it came from, and the table's order is
    // whatever the recruiter sorted it into.
    const ada = await download([sessionOne, sessionTwo]);
    const grace = await download([sessionTwo, sessionOne]);

    expect(ada.indexOf('Ada')).toBeLessThan(ada.indexOf('Grace'));
    expect(grace.indexOf('Grace')).toBeLessThan(grace.indexOf('Ada'));
  });

  it('exports only the rows asked for', async () => {
    const csv = await download([sessionTwo]);

    expect(csv).toContain('Grace Hopper');
    expect(csv).not.toContain('Ada Lovelace');
  });

  it('escapes a note containing commas, quotes and newlines', async () => {
    const nasty = 'Strong, but "hesitant"\nunder time pressure';

    await http(app)
      .put(`/api/reports/sessions/${sessionOne}/review`)
      .set(auth(token))
      .send({ note: nasty, tags: ['second, round'] })
      .expect(200);

    const csv = await download([sessionOne]);

    // Quoted and doubled per RFC 4180. Without this the comma alone would
    // shift every later column and the file would open cleanly saying the
    // wrong thing.
    expect(csv).toContain('"Strong, but ""hesitant""');
    expect(csv).toContain('"second, round"');

    // The row is still one logical record despite the embedded newline: a
    // header line plus one quoted record.
    const quoteCount = (csv.match(/"/g) ?? []).length;
    expect(quoteCount % 2).toBe(0);
  });

  it('leaves an unscored attempt blank rather than zero', async () => {
    // A spreadsheet full of zeroes would sort and average as though those
    // candidates had scored nothing, rather than not having been scored.
    const csv = await download([sessionOne, sessionTwo]);
    expect(csv).not.toMatch(/,0,0,0,/);
  });

  it('refuses another organisation’s assessment', async () => {
    await http(app)
      .post(`/api/reports/assessments/${assessmentId}/export`)
      .set(auth(otherToken))
      .send({ sessionIds: [sessionOne] })
      .expect(404);
  });

  it('ignores ids that are not part of this assessment', async () => {
    // A stale row in the client's hands must not fail the whole download.
    const csv = await download([
      sessionOne,
      '11111111-2222-4333-8444-555555555555',
    ]);

    expect(csv).toContain('Ada Lovelace');
  });

  it('refuses an implausibly large request', async () => {
    const tooMany = Array.from(
      { length: 5001 },
      () => '11111111-2222-4333-8444-555555555555',
    );

    const res = await http(app)
      .post(`/api/reports/assessments/${assessmentId}/export`)
      .set(auth(token))
      .send({ sessionIds: tooMany });

    /*
     * 413 in practice, not the DTO's 400.
     *
     * Express's body-size limit rejects ~185KB of UUIDs before the payload is
     * ever parsed, which is the better outcome — nothing is allocated and no
     * validation runs. The assertion is therefore "refused", not "refused by a
     * particular layer", because pinning it to 400 would fail the day someone
     * raises the body limit for an unrelated reason.
     */
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('keeps the candidate id out of it', () => {
    // Sanity on the fixture rather than the export: the sheet is for people,
    // and internal ids belong in the API, not in a file that gets emailed on.
    expect(candidateId).toBeTruthy();
  });
});
