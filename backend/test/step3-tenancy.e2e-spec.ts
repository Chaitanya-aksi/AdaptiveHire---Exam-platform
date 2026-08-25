import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, http, uniqueEmail } from './helpers';
import { E2E_ORG_PREFIX } from './e2e.constants';

/**
 * Tenancy isolation: one organisation must not be able to reach another's data.
 *
 * This is the highest-severity failure the system has. Every recruiter query
 * takes its scope from `@CurrentOrg()`, and a single dropped `WHERE` clause
 * turns an endpoint into a list of every customer's rows — which is a
 * personal-data breach, not a bug. Until this suite existed that rule was held
 * up entirely by code review.
 *
 * Two things are asserted throughout:
 *
 *  - **404, never 403.** A 403 confirms the id exists, which lets an outsider
 *    enumerate another customer's assessments and candidates one guess at a
 *    time. The only deliberate 403 is writing to a *platform* question, which is
 *    genuinely visible to everyone and genuinely read-only — that one is
 *    asserted explicitly below so the distinction cannot quietly erode.
 *  - **List endpoints leak too.** An id-based 404 is worthless if the
 *    corresponding index hands back every organisation's rows anyway, so the
 *    collection endpoints are checked as well.
 */

const PASSWORD = 'TenancyTest!2345';

/** One organisation and the recruiter who owns it. */
interface Org {
  token: string;
  userId: string;
  email: string;
}

describe('Step 3 — Tenancy isolation', () => {
  let app: INestApplication;

  let orgA: Org;
  let orgB: Org;

  // Resources belonging to org A. Org B asks for each of these by id.
  let aAssessmentId: string;
  let aQuestionId: string;
  let aInvitationId: string;
  let aSessionId: string;
  let aCandidateId: string;

  /** A seeded, platform-owned question — visible to everyone, writable by none. */
  let platformQuestionId: string;

  let moduleId: string;

  const auth = (org: Org) => ({ Authorization: `Bearer ${org.token}` });

  /** Registers a recruiter, which creates their workspace. */
  async function registerOrg(label: string): Promise<Org> {
    const email = uniqueEmail(`tenancy-${label}`);
    const res = await http(app)
      .post('/api/auth/register')
      .send({
        email,
        password: PASSWORD,
        fullName: `Tenancy ${label.toUpperCase()}`,
        accountType: 'recruiter',
        // The prefix is what the global teardown sweeps on.
        organisationName: `${E2E_ORG_PREFIX}${label} ${Date.now()}`,
      })
      .expect(201);

    const body = res.body as { accessToken: string; user: { id: string } };
    return { token: body.accessToken, userId: body.user.id, email };
  }

  beforeAll(async () => {
    app = await createTestApp();
    const ds = app.get(DataSource);

    orgA = await registerOrg('a');
    orgB = await registerOrg('b');

    // Shared reference data — modules are not org-scoped, and deliberately so.
    const modules = await http(app)
      .get('/api/modules')
      .set(auth(orgA))
      .expect(200);
    moduleId = (modules.body as { id: string; slug: string }[]).find(
      (m) => m.slug === 'aptitude',
    )!.id;

    const platform = await ds.query<{ id: string }[]>(
      `SELECT id FROM questions WHERE "organisationId" IS NULL LIMIT 1`,
    );
    if (platform.length === 0) {
      throw new Error(
        'No platform-owned question found — run `npm run seed` first.',
      );
    }
    platformQuestionId = platform[0].id;

    // ── Everything below belongs to org A ──────────────────────────────────

    const assessment = await http(app)
      .post('/api/assessments')
      .set(auth(orgA))
      .send({
        title: 'Tenancy A assessment',
        modules: [
          {
            moduleId,
            questionCount: 3,
            timeLimitSeconds: 600,
          },
        ],
      })
      .expect(201);
    aAssessmentId = (assessment.body as { id: string }).id;

    const question = await http(app)
      .post('/api/questions')
      .set(auth(orgA))
      .send({
        moduleId,
        questionText: 'Tenancy A private question',
        tags: ['e2e'],
        mcq: {
          options: [
            { key: 'A', text: '1' },
            { key: 'B', text: '2' },
            { key: 'C', text: '3' },
            { key: 'D', text: '4' },
          ],
          correctOption: 'B',
          difficultyScore: 900,
        },
      })
      .expect(201);
    aQuestionId = (question.body as { id: string }).id;

    const invitation = await http(app)
      .post(`/api/assessments/${aAssessmentId}/invitations`)
      .set(auth(orgA))
      .send({
        email: uniqueEmail('tenancy-candidate'),
        fullName: 'Tenancy Cand',
      })
      .expect(201);
    aInvitationId = (invitation.body as { id: string; email: string }).id;

    // Inviting an unknown address provisions the account, so the candidate row
    // already exists and can own the session below.
    const candidate = await ds.query<{ id: string }[]>(
      `SELECT "candidateId" AS id FROM invitations WHERE id = $1`,
      [aInvitationId],
    );
    aCandidateId = candidate[0].id;

    // Inserted directly rather than sat: what is under test is the scoping on
    // the report endpoints, not the runtime that produces a session.
    const session = await ds.query<{ id: string }[]>(
      `INSERT INTO assessment_sessions
         ("invitationId", "assessmentId", "candidateId", status, "startedAt", "expiresAt", "submittedAt")
       VALUES ($1, $2, $3, 'completed', now(), now() + interval '1 hour', now())
       RETURNING id`,
      [aInvitationId, aAssessmentId, aCandidateId],
    );
    aSessionId = session[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── Assessments ──────────────────────────────────────────────────────────

  describe('assessments', () => {
    it('hides another organisation’s assessment behind a 404', async () => {
      await http(app)
        .get(`/api/assessments/${aAssessmentId}`)
        .set(auth(orgB))
        .expect(404);
    });

    it('refuses to repoint another organisation’s question pool', async () => {
      await http(app)
        .put(`/api/assessments/${aAssessmentId}/questions`)
        .set(auth(orgB))
        .send({ questionIds: [] })
        .expect(404);
    });

    it('refuses to delete another organisation’s assessment', async () => {
      await http(app)
        .delete(`/api/assessments/${aAssessmentId}`)
        .set(auth(orgB))
        .expect(404);
    });

    it('leaves it readable by its owner', async () => {
      // The counterweight to every 404 above: proves they are scoping, not an
      // endpoint that is simply broken for everyone.
      await http(app)
        .get(`/api/assessments/${aAssessmentId}`)
        .set(auth(orgA))
        .expect(200);
    });

    it('keeps it out of the other organisation’s list', async () => {
      const res = await http(app)
        .get('/api/assessments')
        .set(auth(orgB))
        .expect(200);

      const ids = (res.body as { id: string }[]).map((a) => a.id);
      expect(ids).not.toContain(aAssessmentId);
    });
  });

  // ── Invitations ──────────────────────────────────────────────────────────

  describe('invitations', () => {
    it('will not list another organisation’s invitees', async () => {
      await http(app)
        .get(`/api/assessments/${aAssessmentId}/invitations`)
        .set(auth(orgB))
        .expect(404);
    });

    it('will not invite into another organisation’s assessment', async () => {
      await http(app)
        .post(`/api/assessments/${aAssessmentId}/invitations`)
        .set(auth(orgB))
        .send({ email: uniqueEmail('tenancy-intruder'), fullName: 'Intruder' })
        .expect(404);
    });

    it('will not bulk-import into another organisation’s assessment', async () => {
      await http(app)
        .post(`/api/assessments/${aAssessmentId}/invitations/bulk-import`)
        .set(auth(orgB))
        .attach(
          'file',
          Buffer.from('name,email\nX,x@e2e.local\n'),
          'invites.csv',
        )
        .expect(404);
    });

    it('will not revoke another organisation’s invitation', async () => {
      await http(app)
        .patch(`/api/invitations/${aInvitationId}/revoke`)
        .set(auth(orgB))
        .expect(404);
    });

    it('will not delete another organisation’s invitation', async () => {
      await http(app)
        .delete(`/api/invitations/${aInvitationId}`)
        .set(auth(orgB))
        .expect(404);
    });
  });

  // ── Question bank ────────────────────────────────────────────────────────

  describe('question bank', () => {
    it('hides another organisation’s private question', async () => {
      await http(app)
        .get(`/api/questions/${aQuestionId}`)
        .set(auth(orgB))
        .expect(404);
    });

    it('refuses to edit it', async () => {
      await http(app)
        .patch(`/api/questions/${aQuestionId}`)
        .set(auth(orgB))
        .send({ questionText: 'Rewritten by another organisation' })
        .expect(404);
    });

    it('refuses to activate it', async () => {
      await http(app)
        .patch(`/api/questions/${aQuestionId}/activate`)
        .set(auth(orgB))
        .expect(404);
    });

    it('refuses to archive it', async () => {
      await http(app)
        .patch(`/api/questions/${aQuestionId}/archive`)
        .set(auth(orgB))
        .expect(404);
    });

    it('refuses to delete it', async () => {
      await http(app)
        .delete(`/api/questions/${aQuestionId}`)
        .set(auth(orgB))
        .expect(404);
    });

    it('keeps it out of the other organisation’s bank listing', async () => {
      const res = await http(app)
        .get('/api/questions?limit=200')
        .set(auth(orgB))
        .expect(200);

      const body = res.body as { items?: { id: string }[] } | { id: string }[];
      const items = Array.isArray(body) ? body : (body.items ?? []);
      expect(items.map((q) => q.id)).not.toContain(aQuestionId);
    });

    it('answers 403, not 404, for writing to a platform question', async () => {
      // The one place a 403 is correct: the question is genuinely visible to
      // this organisation and genuinely read-only, so there is nothing to hide
      // and "not found" would be a lie. Editing forks it instead.
      await http(app)
        .delete(`/api/questions/${platformQuestionId}`)
        .set(auth(orgB))
        .expect(403);
    });
  });

  // ── Reports ──────────────────────────────────────────────────────────────

  describe('reports', () => {
    it('will not list results for another organisation’s assessment', async () => {
      await http(app)
        .get(`/api/reports/assessments/${aAssessmentId}`)
        .set(auth(orgB))
        .expect(404);
    });

    it('will not return another organisation’s report summary', async () => {
      await http(app)
        .get(`/api/reports/sessions/${aSessionId}`)
        .set(auth(orgB))
        .expect(404);
    });

    it('will not return another organisation’s answer-by-answer detail', async () => {
      await http(app)
        .get(`/api/reports/sessions/${aSessionId}/detail`)
        .set(auth(orgB))
        .expect(404);
    });

    it('will not regenerate another organisation’s report', async () => {
      await http(app)
        .post(`/api/reports/sessions/${aSessionId}/regenerate`)
        .set(auth(orgB))
        .expect(404);
    });
  });

  // ── People directory ─────────────────────────────────────────────────────

  describe('people directory', () => {
    it('does not show another organisation’s members', async () => {
      const res = await http(app).get('/api/users').set(auth(orgB)).expect(200);

      const body = res.body as { items?: { id: string }[] } | { id: string }[];
      const items = Array.isArray(body) ? body : (body.items ?? []);
      const ids = items.map((u) => u.id);

      expect(ids).not.toContain(orgA.userId);
      // The candidate is org-less and shared, but org B has never invited them,
      // so they belong to org A's directory and not to B's.
      expect(ids).not.toContain(aCandidateId);
    });

    it('refuses to delete another organisation’s member', async () => {
      await http(app)
        .delete(`/api/users/${orgA.userId}`)
        .set(auth(orgB))
        .expect(404);
    });

    it('refuses to delete a candidate it has never invited', async () => {
      await http(app)
        .delete(`/api/users/${aCandidateId}`)
        .set(auth(orgB))
        .expect(404);
    });
  });
});
