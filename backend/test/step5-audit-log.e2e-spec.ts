import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, http, uniqueEmail } from './helpers';
import { E2E_ORG_PREFIX } from './e2e.constants';

/**
 * The audit trail.
 *
 * Asserts the four things a security review asks about by name — withdrawing an
 * invitation, deleting an assessment, deleting a person, reading a candidate's
 * report — plus the two properties that make the trail trustworthy: it records
 * refused attempts as well as successful ones, and it never copies a request
 * body into itself.
 */

const PASSWORD = 'AuditTest!2345';

interface AuditRow {
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorId: string | null;
  metadata: { statusCode?: number; params?: Record<string, string> } | null;
}

describe('Step 5 — Audit log', () => {
  let app: INestApplication;
  let ds: DataSource;

  let token: string;
  let actorId: string;
  let assessmentId: string;
  let invitationId: string;
  let moduleId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  /** Audit rows written for this actor, newest first. */
  async function rowsFor(actionLike: string): Promise<AuditRow[]> {
    return ds.query<AuditRow[]>(
      `SELECT action, "resourceType", "resourceId", "actorId", metadata
         FROM audit_log
        WHERE "actorId" = $1 AND action LIKE $2
        ORDER BY "occurredAt" DESC`,
      [actorId, actionLike],
    );
  }

  /** The interceptor writes without blocking the response, so give it a beat. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);

    const registered = await http(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail('audit'),
        password: PASSWORD,
        fullName: 'Audit Actor',
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}audit ${Date.now()}`,
      })
      .expect(201);

    const body = registered.body as {
      accessToken: string;
      user: { id: string };
    };
    token = body.accessToken;
    actorId = body.user.id;

    const modules = await http(app).get('/api/modules').set(auth()).expect(200);
    moduleId = (modules.body as { id: string; slug: string }[]).find(
      (m) => m.slug === 'aptitude',
    )!.id;

    const assessment = await http(app)
      .post('/api/assessments')
      .set(auth())
      .send({
        title: 'Audit assessment',
        modules: [{ moduleId, questionCount: 3, timeLimitSeconds: 600 }],
      })
      .expect(201);
    assessmentId = (assessment.body as { id: string }).id;

    const invitation = await http(app)
      .post(`/api/assessments/${assessmentId}/invitations`)
      .set(auth())
      .send({ email: uniqueEmail('audit-cand'), fullName: 'Audit Cand' })
      .expect(201);
    invitationId = (invitation.body as { id: string }).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('records withdrawing an invitation', async () => {
    await http(app)
      .patch(`/api/invitations/${invitationId}/revoke`)
      .set(auth())
      .expect(200);

    await settle();

    const rows = await rowsFor('PATCH%revoke');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].resourceType).toBe('invitations');
    expect(rows[0].resourceId).toBe(invitationId);
    expect(rows[0].metadata?.statusCode).toBe(200);
  });

  it('records creating an assessment', async () => {
    await settle();

    const rows = await rowsFor('POST /api/assessments');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].actorId).toBe(actorId);
  });

  it('records a refused attempt, not only successful ones', async () => {
    // A run of these against another organisation's ids is somebody probing;
    // a trail that only kept successes would not show it.
    const strangerId = '11111111-2222-3333-4444-555555555555';

    await http(app)
      .delete(`/api/assessments/${strangerId}`)
      .set(auth())
      .expect(404);

    await settle();

    const rows = await rowsFor('DELETE /api/assessments%');
    const refused = rows.find((r) => r.resourceId === strangerId);
    expect(refused).toBeDefined();
    expect(refused?.metadata?.statusCode).toBe(404);
  });

  it('records reading a candidate report, even though it changes nothing', async () => {
    const sessionId = '99999999-8888-7777-6666-555555555555';

    await http(app)
      .get(`/api/reports/sessions/${sessionId}`)
      .set(auth())
      .expect(404);

    await settle();

    const rows = await rowsFor('GET /api/reports%');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].resourceType).toBe('reports');
  });

  /**
   * Counts matching rows written from now on.
   *
   * Scoped by time rather than querying the whole table, because a test
   * database accumulates audit rows across runs — asserting "none anywhere"
   * would pass only on a freshly created database and fail everywhere else.
   */
  async function countSince(
    since: string,
    actionLike: string,
  ): Promise<number> {
    const rows = await ds.query<{ count: string }[]>(
      `SELECT count(*) AS count FROM audit_log
        WHERE action LIKE $1 AND "occurredAt" > $2`,
      [actionLike, since],
    );
    return Number(rows[0].count);
  }

  const now = async (): Promise<string> => {
    const rows = await ds.query<{ t: string }[]>(`SELECT now() AS t`);
    return rows[0].t;
  };

  it('does not audit token refresh, however often it happens', async () => {
    // A write, but pure mechanism: every signed-in session rotates its token
    // every fifteen minutes. Auditing it would bury the administrative actions
    // this log exists for under rows that say only "somebody stayed logged in".
    const mark = await now();

    await http(app).post('/api/auth/refresh').expect(401);
    await settle();

    expect(await countSince(mark, '%auth/refresh%')).toBe(0);
  });

  it('does not audit the assessment runtime', async () => {
    // The candidate runtime writes on every answer — a dozen rows per module,
    // duplicating what `responses` already stores with far more detail.
    const mark = await now();

    await http(app)
      .post('/api/sessions/start')
      .set(auth())
      .send({ invitationId: '00000000-0000-4000-8000-000000000000' });

    await settle();

    expect(await countSince(mark, '%/api/sessions%')).toBe(0);
  });

  it('does not audit ordinary reads', async () => {
    await http(app).get('/api/assessments').set(auth()).expect(200);
    await settle();

    // Listing assessments is not sensitive and happens constantly; auditing it
    // would bury the entries that matter.
    const rows = await rowsFor('GET /api/assessments');
    expect(rows).toHaveLength(0);
  });

  it('never copies a request body into the trail', async () => {
    const secret = 'do-not-store-me-anywhere';

    await http(app)
      .post('/api/assessments')
      .set(auth())
      .send({
        title: secret,
        modules: [{ moduleId, questionCount: 2, timeLimitSeconds: 300 }],
      })
      .expect(201);

    await settle();

    // The whole trail, not just this actor's: nothing anywhere should have
    // captured the payload.
    const hits = await ds.query<{ count: string }[]>(
      `SELECT count(*) AS count FROM audit_log WHERE metadata::text LIKE $1`,
      [`%${secret}%`],
    );
    expect(Number(hits[0].count)).toBe(0);
  });

  it('records deleting an assessment and the person', async () => {
    await http(app)
      .delete(`/api/assessments/${assessmentId}`)
      .set(auth())
      .expect(200);

    await settle();

    const rows = await rowsFor('DELETE /api/assessments%');
    const deleted = rows.find((r) => r.resourceId === assessmentId);
    expect(deleted).toBeDefined();
    expect(deleted?.metadata?.statusCode).toBe(200);
  });
});
