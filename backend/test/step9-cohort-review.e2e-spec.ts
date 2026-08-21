import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, http, uniqueEmail } from './helpers';
import { E2E_ORG_PREFIX } from './e2e.constants';

/**
 * The cohort view and the review state behind it.
 *
 * Two properties carry most of the risk. The review row is shared by a whole
 * organisation, so a partial update that quietly blanked a colleague's note
 * would lose real work with no error. And it is *per organisation*, so a
 * shared candidate must not carry one company's rejection into another's list.
 */

const PASSWORD = 'CohortView!2345';

interface Attempt {
  sessionId: string;
  candidate: { fullName: string };
  overallScore: number | null;
  /** Position within this assessment's cohort, out of `cohortSize`. */
  rank: number | null;
  cohortSize: number;
  review: {
    decision: string | null;
    tags: string[];
    note: string | null;
    updatedBy: string | null;
    rejectionEmailSentAt: string | null;
  } | null;
}

describe('Step 9 — Cohort view and review', () => {
  let app: INestApplication;
  let ds: DataSource;

  let tokenA: string;
  let tokenB: string;
  let moduleId: string;
  let assessmentA: string;
  let assessmentB: string;
  let candidateId: string;
  let sessionA: string;
  let sessionB: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function registerOrg(label: string): Promise<string> {
    const res = await http(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail(`cohort-${label}`),
        password: PASSWORD,
        fullName: `Cohort ${label.toUpperCase()}`,
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}cohort-${label} ${Date.now()}`,
      })
      .expect(201);
    return (res.body as { accessToken: string }).accessToken;
  }

  async function makeAssessment(token: string): Promise<string> {
    const res = await http(app)
      .post('/api/assessments')
      .set(auth(token))
      .send({
        title: 'Cohort assessment',
        modules: [
          { moduleId, minQuestions: 1, maxQuestions: 5, timeLimitSeconds: 600 },
        ],
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  /** One submitted attempt by the shared candidate on the given assessment. */
  async function makeAttempt(assessmentId: string): Promise<string> {
    const invite = await ds.query<{ id: string }[]>(
      `INSERT INTO invitations ("assessmentId", email, status, "candidateId")
       VALUES ($1, $2, 'completed', $3) RETURNING id`,
      [assessmentId, uniqueEmail('cohort-cand'), candidateId],
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
       VALUES ($1,$2,1000,10,6)`,
      [session[0].id, moduleId],
    );
    return session[0].id;
  }

  const cohort = async (token: string, assessmentId: string) => {
    const res = await http(app)
      .get(`/api/reports/assessments/${assessmentId}`)
      .set(auth(token))
      .expect(200);
    return res.body as Attempt[];
  };

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);

    tokenA = await registerOrg('a');
    tokenB = await registerOrg('b');

    const modules = await http(app)
      .get('/api/modules')
      .set(auth(tokenA))
      .expect(200);
    moduleId = (modules.body as { id: string; slug: string }[]).find(
      (m) => m.slug === 'aptitude',
    )!.id;

    assessmentA = await makeAssessment(tokenA);
    assessmentB = await makeAssessment(tokenB);

    // One person, sitting for both companies — the case the per-organisation
    // rule exists for.
    const candidate = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, "passwordHash", "fullName", role)
       VALUES ($1, 'x', 'Shared Candidate', 'candidate') RETURNING id`,
      [uniqueEmail('cohort-shared')],
    );
    candidateId = candidate[0].id;

    sessionA = await makeAttempt(assessmentA);
    sessionB = await makeAttempt(assessmentB);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists attempts with no review until somebody acts', async () => {
    const rows = await cohort(tokenA, assessmentA);

    expect(rows).toHaveLength(1);
    // Null, not an empty review: never looked at and looked-at-but-undecided
    // are different states, and the list distinguishes them.
    expect(rows[0].review).toBeNull();
  });

  it('records a decision and who made it', async () => {
    await http(app)
      .put(`/api/reports/sessions/${sessionA}/review`)
      .set(auth(tokenA))
      .send({ decision: 'shortlisted', tags: ['second round'] })
      .expect(200);

    const rows = await cohort(tokenA, assessmentA);
    expect(rows[0].review?.decision).toBe('shortlisted');
    expect(rows[0].review?.tags).toEqual(['second round']);
    expect(rows[0].review?.updatedBy).toBe('Cohort A');
  });

  it('leaves fields alone that the caller did not send', async () => {
    await http(app)
      .put(`/api/reports/sessions/${sessionA}/review`)
      .set(auth(tokenA))
      .send({ note: 'Strong on the reasoning section.' })
      .expect(200);

    // The whole point of the partial update: writing a note from the detail
    // view must not undo a shortlisting made from the list.
    const rows = await cohort(tokenA, assessmentA);
    expect(rows[0].review?.note).toBe('Strong on the reasoning section.');
    expect(rows[0].review?.decision).toBe('shortlisted');
    expect(rows[0].review?.tags).toEqual(['second round']);
  });

  it('clears a decision when null is sent explicitly', async () => {
    await http(app)
      .put(`/api/reports/sessions/${sessionA}/review`)
      .set(auth(tokenA))
      .send({ decision: null })
      .expect(200);

    const rows = await cohort(tokenA, assessmentA);
    expect(rows[0].review?.decision).toBeNull();
    // Everything else survives — null means "undecide", not "reset".
    expect(rows[0].review?.note).toBe('Strong on the reasoning section.');
  });

  it('keeps one organisation’s review out of another’s cohort', async () => {
    await http(app)
      .put(`/api/reports/sessions/${sessionB}/review`)
      .set(auth(tokenB))
      .send({ decision: 'rejected', note: 'Not for this role.' })
      .expect(200);

    // The same person, sat for both. Company A must not see B's rejection.
    const forA = await cohort(tokenA, assessmentA);
    expect(forA[0].review?.decision).toBeNull();
    expect(forA[0].review?.note).toBe('Strong on the reasoning section.');

    const forB = await cohort(tokenB, assessmentB);
    expect(forB[0].review?.decision).toBe('rejected');
  });

  it('refuses to review another organisation’s attempt', async () => {
    await http(app)
      .put(`/api/reports/sessions/${sessionA}/review`)
      .set(auth(tokenB))
      .send({ decision: 'rejected' })
      .expect(404);
  });

  it('survives the report being regenerated', async () => {
    // `reports` is rebuilt from the answers; `candidate_reviews` is what people
    // decided, and must not be collateral damage.
    await http(app)
      .post(`/api/reports/sessions/${sessionA}/regenerate`)
      .set(auth(tokenA))
      .expect(201);

    const rows = await cohort(tokenA, assessmentA);
    expect(rows[0].review?.note).toBe('Strong on the reasoning section.');
  });

  /*
   * Telling the candidate.
   *
   * The rejection email is the only thing in the product that reaches a person
   * and cannot be recalled, so what is tested here is mostly what it *refuses*
   * to do: send without a decision, send twice, or send on someone else's
   * candidate. The happy path is one assertion; the guards are the feature.
   */
  describe('rejection email', () => {
    /** A fresh attempt per test, so a send in one cannot satisfy another. */
    let session: string;

    beforeEach(async () => {
      session = await makeAttempt(assessmentA);
    });

    const send = (token: string, sessionId: string) =>
      http(app)
        .post(`/api/reports/sessions/${sessionId}/rejection-email`)
        .set(auth(token));

    const reject = (sessionId: string) =>
      http(app)
        .put(`/api/reports/sessions/${sessionId}/review`)
        .set(auth(tokenA))
        .send({ decision: 'rejected' })
        .expect(200);

    it('refuses to send before the candidate has been rejected', async () => {
      // Guards against the API being driven directly, and against a UI that
      // offers the button on a row nobody has decided on.
      await send(tokenA, session).expect(400);

      await http(app)
        .put(`/api/reports/sessions/${session}/review`)
        .set(auth(tokenA))
        .send({ decision: 'shortlisted' })
        .expect(200);

      // Shortlisted is not "not rejected yet" — it is the opposite decision.
      await send(tokenA, session).expect(400);
    });

    it('emails the candidate on the click that rejects them', async () => {
      // The behaviour the feature exists for: one click, and they are told.
      const res = await reject(session);

      const sentAt = (res.body as { rejectionEmailSentAt: string | null })
        .rejectionEmailSentAt;
      expect(sentAt).not.toBeNull();
      expect(Number.isNaN(Date.parse(sentAt!))).toBe(false);

      const rows = await cohort(tokenA, assessmentA);
      const row = rows.find((r) => r.sessionId === session)!;
      expect(row.review?.rejectionEmailSentAt).toBe(sentAt);
    });

    it('does not email again when the same decision is re-applied', async () => {
      const first = await reject(session);
      const sentAt = (first.body as { rejectionEmailSentAt: string })
        .rejectionEmailSentAt;

      // Re-applying `rejected` to someone already rejected is a no-op, not a
      // reason to tell them a second time. (Clearing the decision is a
      // separate matter and is refused outright — see the freeze tests below.)
      const second = await reject(session);

      // Same stamp, not a new one.
      expect(
        (second.body as { rejectionEmailSentAt: string }).rejectionEmailSentAt,
      ).toBe(sentAt);
    });

    it('does not email when a note or tag is edited afterwards', async () => {
      const first = await reject(session);
      const sentAt = (first.body as { rejectionEmailSentAt: string })
        .rejectionEmailSentAt;

      // `saveReview` is the same endpoint for notes and tags. Those send no
      // decision at all, so they must not look like a fresh rejection.
      const noted = await http(app)
        .put(`/api/reports/sessions/${session}/review`)
        .set(auth(tokenA))
        .send({ note: 'Strong communicator, wrong role.', tags: ['keep warm'] })
        .expect(200);

      expect(
        (noted.body as { rejectionEmailSentAt: string }).rejectionEmailSentAt,
      ).toBe(sentAt);
    });

    it('does not email when a candidate is shortlisted', async () => {
      const res = await http(app)
        .put(`/api/reports/sessions/${session}/review`)
        .set(auth(tokenA))
        .send({ decision: 'shortlisted' })
        .expect(200);

      expect(
        (res.body as { rejectionEmailSentAt: string | null })
          .rejectionEmailSentAt,
      ).toBeNull();
    });

    it('refuses a manual send once the click already sent it', async () => {
      await reject(session);

      // The manual route is the retry for a send that did not happen. Once one
      // has, it must refuse rather than send a second.
      await send(tokenA, session).expect(409);
    });

    it('sends manually for an attempt rejected before the email existed', async () => {
      // Exactly the shape of a row that predates this feature: decided, never
      // emailed. Written directly, because the API no longer produces one.
      await ds.query(
        `INSERT INTO candidate_reviews ("sessionId","organisationId",decision)
         SELECT $1, "organisationId", 'rejected' FROM assessments WHERE id = $2`,
        [session, assessmentA],
      );

      const res = await send(tokenA, session).expect(201);
      expect((res.body as { to: string }).to).toContain('@');
    });

    it('will not send on another organisation’s attempt', async () => {
      await reject(session);

      // 404, not 403 — the same rule as every other cross-tenant read, so a
      // session id cannot be probed by watching which error comes back.
      await send(tokenB, session).expect(404);
    });
  });

  /*
   * A told rejection is final.
   *
   * The candidate has read it. Flipping the flag back in our database does not
   * un-read it, and would leave the workspace showing a state the candidate has
   * every reason to believe is false — so the decision freezes and the way back
   * is to actually write to them.
   */
  describe('once the candidate has been told', () => {
    let session: string;

    beforeEach(async () => {
      session = await makeAttempt(assessmentA);
      await http(app)
        .put(`/api/reports/sessions/${session}/review`)
        .set(auth(tokenA))
        .send({ decision: 'rejected' })
        .expect(200);
    });

    const review = (body: Record<string, unknown>) =>
      http(app)
        .put(`/api/reports/sessions/${session}/review`)
        .set(auth(tokenA))
        .send(body);

    it('cannot be shortlisted again', async () => {
      await review({ decision: 'shortlisted' }).expect(409);
    });

    it('cannot have the decision cleared', async () => {
      // Clearing is the same problem wearing a different hat: it would show an
      // undecided candidate who has already been turned down in writing.
      await review({ decision: null }).expect(409);
    });

    it('still accepts notes and tags', async () => {
      // Only the decision is frozen. The team's own record of why should keep
      // growing — that is what a note is for, and it never leaves the
      // workspace.
      const res = await review({
        note: 'Reconsider for the platform role.',
        tags: ['keep warm'],
      }).expect(200);

      expect((res.body as { note: string }).note).toBe(
        'Reconsider for the platform role.',
      );
    });

    it('accepts re-sending the same decision as a no-op', async () => {
      // Idempotent: setting `rejected` on someone already rejected changes
      // nothing and must not read as an attempt to reverse it.
      await review({ decision: 'rejected' }).expect(200);
    });

    it('lets the team write to the candidate instead', async () => {
      const res = await http(app)
        .post(`/api/reports/sessions/${session}/messages`)
        .set(auth(tokenA))
        .send({ message: 'We would like to talk to you about another role.' })
        .expect(201);

      const body = res.body as { body: string; sentTo: string };
      expect(body.body).toBe(
        'We would like to talk to you about another role.',
      );
      expect(body.sentTo).toContain('@');
    });

    it('keeps every message rather than overwriting', async () => {
      // The record answers "what did we say to this person?", which an
      // edited-in-place field could not.
      for (const text of ['First approach.', 'Second approach.']) {
        await http(app)
          .post(`/api/reports/sessions/${session}/messages`)
          .set(auth(tokenA))
          .send({ message: text })
          .expect(201);
      }

      const res = await http(app)
        .get(`/api/reports/sessions/${session}/messages`)
        .set(auth(tokenA))
        .expect(200);

      const rows = res.body as { body: string }[];
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.body).sort()).toEqual([
        'First approach.',
        'Second approach.',
      ]);
    });

    it('refuses an empty message', async () => {
      await http(app)
        .post(`/api/reports/sessions/${session}/messages`)
        .set(auth(tokenA))
        .send({ message: '   ' })
        .expect(400);
    });

    it('will not write to another organisation’s candidate', async () => {
      await http(app)
        .post(`/api/reports/sessions/${session}/messages`)
        .set(auth(tokenB))
        .send({ message: 'Not yours to send.' })
        .expect(404);

      await http(app)
        .get(`/api/reports/sessions/${session}/messages`)
        .set(auth(tokenB))
        .expect(404);
    });
  });

  it('rejects a decision it does not recognise', async () => {
    await http(app)
      .put(`/api/reports/sessions/${sessionA}/review`)
      .set(auth(tokenA))
      .send({ decision: 'maybe' })
      .expect(400);
  });

  it('ranks the scored attempts and gives the rest no position at all', async () => {
    const rows = await cohort(tokenA, assessmentA);

    // Most attempts here were inserted straight into the tables and never had a
    // report built, so they carry no score. Null is the right answer for those:
    // an unscored attempt is missing data, not last place. What must never
    // happen is a 0 standing in for it.
    const ranked = rows.filter((row) => row.rank !== null);
    expect(ranked.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.rank === null).toBe(row.overallScore === null);
      // The denominator is the population the rank is drawn from, so a position
      // can never fall outside it — "1st of 0" is not a standing.
      expect(row.cohortSize).toBe(ranked.length);
      if (row.rank !== null) {
        expect(row.rank).toBeGreaterThanOrEqual(1);
        expect(row.rank).toBeLessThanOrEqual(row.cohortSize);
      }
    }
  });
});
