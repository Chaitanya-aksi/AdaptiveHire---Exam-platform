import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { createTestApp, http, uniqueEmail } from './helpers';
import { E2E_ORG_PREFIX } from './e2e.constants';

/**
 * Scheduled windows.
 *
 * The resolution rules are unit-tested; what this suite is for is that the
 * runtime actually enforces them — a window nothing checks is a promise to a
 * recruiter that the product does not keep.
 */

const PASSWORD = 'Windows!2345';

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 60 * 60 * 1000;

describe('Step 13 — Assessment windows', () => {
  let app: INestApplication;
  let ds: DataSource;

  let recruiterToken: string;
  let moduleId: string;

  const auth = () => ({ Authorization: `Bearer ${recruiterToken}` });

  /** An assessment with the given window, plus an invited, signed-in candidate. */
  async function scenario(window: {
    opensAt?: string;
    closesAt?: string;
  }): Promise<{
    candidateToken: string;
    invitationId: string;
    assessmentId: string;
  }> {
    const assessment = await http(app)
      .post('/api/assessments')
      .set(auth())
      .send({
        title: 'Windowed assessment',
        modules: [{ moduleId, questionCount: 3, timeLimitSeconds: 600 }],
        ...window,
      })
      .expect(201);
    const assessmentId = (assessment.body as { id: string }).id;

    const email = uniqueEmail('window-cand');
    const invited = await http(app)
      .post(`/api/assessments/${assessmentId}/invitations`)
      .set(auth())
      .send({ email, fullName: 'Window Candidate' })
      .expect(201);

    // Inviting an unknown address provisions the account with a generated
    // password that is never returned, so a known one is written directly.
    // `mustChangePassword` is cleared too — otherwise the provisioned account
    // is gated on the set-password screen and never reaches the runtime.
    await ds.query(
      `UPDATE users SET "passwordHash" = $1, "mustChangePassword" = false WHERE email = $2`,
      [await argon2.hash(PASSWORD), email],
    );

    const signedIn = await http(app)
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    return {
      candidateToken: (signedIn.body as { accessToken: string }).accessToken,
      invitationId: (invited.body as { id: string }).id,
      assessmentId,
    };
  }

  const start = (token: string, invitationId: string) =>
    http(app)
      .post('/api/sessions/start')
      .set({ Authorization: `Bearer ${token}` })
      .send({ invitationId });

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);

    const recruiter = await http(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail('windows'),
        password: PASSWORD,
        fullName: 'Windows Owner',
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}windows ${Date.now()}`,
      })
      .expect(201);
    recruiterToken = (recruiter.body as { accessToken: string }).accessToken;

    const modules = await http(app).get('/api/modules').set(auth()).expect(200);
    moduleId = (modules.body as { id: string; slug: string }[]).find(
      (m) => m.slug === 'aptitude',
    )!.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets a candidate start when there is no window', async () => {
    // Every assessment created before scheduling existed is this case.
    const { candidateToken, invitationId } = await scenario({});
    await start(candidateToken, invitationId).expect(201);
  });

  it('refuses before the window opens', async () => {
    const { candidateToken, invitationId } = await scenario({
      opensAt: iso(HOUR),
      closesAt: iso(24 * HOUR),
    });

    const res = await start(candidateToken, invitationId).expect(403);
    expect(JSON.stringify(res.body)).toContain('not opened');
  });

  it('refuses after the window closes', async () => {
    const { candidateToken, invitationId } = await scenario({
      opensAt: iso(-48 * HOUR),
      closesAt: iso(-HOUR),
    });

    const res = await start(candidateToken, invitationId).expect(403);
    expect(JSON.stringify(res.body)).toContain('closed');
  });

  it('lets a candidate start inside the window', async () => {
    const { candidateToken, invitationId } = await scenario({
      opensAt: iso(-HOUR),
      closesAt: iso(HOUR),
    });

    await start(candidateToken, invitationId).expect(201);
  });

  // ── Rescheduling ─────────────────────────────────────────────────────────

  it('lets a recruiter reschedule one candidate into an open window', async () => {
    const { candidateToken, invitationId } = await scenario({
      opensAt: iso(HOUR),
      closesAt: iso(24 * HOUR),
    });

    await start(candidateToken, invitationId).expect(403);

    // The person who joined the intake late, or was ill on the day.
    await http(app)
      .patch(`/api/invitations/${invitationId}/schedule`)
      .set(auth())
      .send({ opensAt: iso(-HOUR) })
      .expect(200);

    await start(candidateToken, invitationId).expect(201);
  });

  it('keeps the round’s deadline when only the start is moved', async () => {
    const { candidateToken, invitationId } = await scenario({
      opensAt: iso(-48 * HOUR),
      closesAt: iso(-HOUR),
    });

    // Moving their start earlier must not hand them an open-ended deadline —
    // a null override means "inherit", not "no bound".
    await http(app)
      .patch(`/api/invitations/${invitationId}/schedule`)
      .set(auth())
      .send({ opensAt: iso(-72 * HOUR) })
      .expect(200);

    await start(candidateToken, invitationId).expect(403);
  });

  it('clears an override when null is sent', async () => {
    const { candidateToken, invitationId } = await scenario({
      opensAt: iso(HOUR),
      closesAt: iso(24 * HOUR),
    });

    await http(app)
      .patch(`/api/invitations/${invitationId}/schedule`)
      .set(auth())
      .send({ opensAt: iso(-HOUR) })
      .expect(200);
    await start(candidateToken, invitationId).expect(201);

    // Back to the round's schedule, which has not opened.
    await http(app)
      .patch(`/api/invitations/${invitationId}/schedule`)
      .set(auth())
      .send({ opensAt: null })
      .expect(200);

    // Already started, so `start` resumes rather than re-checking — assert on
    // the stored value instead.
    const rows = await ds.query<{ opensAt: string | null }[]>(
      `SELECT "opensAt" FROM invitations WHERE id = $1`,
      [invitationId],
    );
    expect(rows[0].opensAt).toBeNull();
  });

  it('refuses a window that closes before it opens', async () => {
    const { invitationId } = await scenario({});

    await http(app)
      .patch(`/api/invitations/${invitationId}/schedule`)
      .set(auth())
      .send({ opensAt: iso(24 * HOUR), expiresAt: iso(HOUR) })
      .expect(400);
  });

  it('will not reschedule another organisation’s invitation', async () => {
    const { invitationId } = await scenario({});

    const stranger = await http(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail('windows-other'),
        password: PASSWORD,
        fullName: 'Other Owner',
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}windows-other ${Date.now()}`,
      })
      .expect(201);

    await http(app)
      .patch(`/api/invitations/${invitationId}/schedule`)
      .set({
        Authorization: `Bearer ${(stranger.body as { accessToken: string }).accessToken}`,
      })
      .send({ opensAt: iso(HOUR) })
      .expect(404);
  });

  // ── What the two UIs are told ────────────────────────────────────────────
  //
  // The runtime enforcing a window is only half of it. If the candidate's list
  // does not know about the window it offers a Start button that then 403s, and
  // if the recruiter's list does not, a reschedule is invisible after it is
  // made. Both surfaces send the window resolved by the same helper, and these
  // tests are what stops either quietly dropping it.

  interface WindowPayload {
    overrideOpensAt: string | null;
    overrideExpiresAt: string | null;
    opensAt: string | null;
    closesAt: string | null;
    state: 'open' | 'not_yet' | 'closed';
  }

  const candidateList = async (token: string) => {
    const res = await http(app)
      .get('/api/me/invitations')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    return res.body as { id: string; window: WindowPayload }[];
  };

  it('tells the candidate’s list a round that has not opened is not open', async () => {
    const opensAt = iso(HOUR);
    const { candidateToken, invitationId } = await scenario({
      opensAt,
      closesAt: iso(24 * HOUR),
    });

    const mine = (await candidateList(candidateToken)).find(
      (i) => i.id === invitationId,
    )!;

    // Without this the card offers Start, the runtime refuses, and the
    // candidate is left reading an error for something they did not do wrong.
    expect(mine.window.state).toBe('not_yet');
    expect(mine.window.opensAt).toBe(new Date(opensAt).toISOString());
    // Inherited from the round, so no override is reported.
    expect(mine.window.overrideOpensAt).toBeNull();
  });

  it('tells the candidate’s attempt page the same thing as their list', async () => {
    const { candidateToken, invitationId } = await scenario({
      opensAt: iso(-48 * HOUR),
      closesAt: iso(-HOUR),
    });

    const fromList = (await candidateList(candidateToken)).find(
      (i) => i.id === invitationId,
    )!;

    const detail = await http(app)
      .get(`/api/me/invitations/${invitationId}`)
      .set({ Authorization: `Bearer ${candidateToken}` })
      .expect(200);

    // Two pages, one answer. They are computed in the same place precisely so
    // a candidate cannot be told "closed" on one and offered Start on the other.
    expect((detail.body as { window: WindowPayload }).window).toEqual(
      fromList.window,
    );
    expect(fromList.window.state).toBe('closed');
  });

  it('shows the recruiter a rescheduled candidate’s own window', async () => {
    const { invitationId, assessmentId } = await scenario({
      opensAt: iso(HOUR),
      closesAt: iso(24 * HOUR),
    });

    const movedTo = iso(-HOUR);
    await http(app)
      .patch(`/api/invitations/${invitationId}/schedule`)
      .set(auth())
      .send({ opensAt: movedTo })
      .expect(200);

    const list = await http(app)
      .get(`/api/assessments/${assessmentId}/invitations`)
      .set(auth())
      .expect(200);

    const row = (list.body as { id: string; window: WindowPayload }[]).find(
      (i) => i.id === invitationId,
    )!;

    // The override is reported separately from the resolved window: the UI
    // needs it to label the row "Rescheduled" and to seed the edit dialog with
    // this candidate's own dates rather than the round's.
    expect(row.window.overrideOpensAt).toBe(new Date(movedTo).toISOString());
    expect(row.window.overrideExpiresAt).toBeNull();
    // The deadline still comes from the round — moving one end must not
    // silently remove the other.
    expect(row.window.closesAt).not.toBeNull();
    expect(row.window.state).toBe('open');
  });

  it('reports no override for a candidate left on the round’s dates', async () => {
    const { invitationId, assessmentId } = await scenario({
      opensAt: iso(-HOUR),
      closesAt: iso(HOUR),
    });

    const list = await http(app)
      .get(`/api/assessments/${assessmentId}/invitations`)
      .set(auth())
      .expect(200);

    const row = (list.body as { id: string; window: WindowPayload }[]).find(
      (i) => i.id === invitationId,
    )!;

    // Both null, but the window itself is populated — the distinction the UI
    // draws between "has their own dates" and "inherits the round's".
    expect(row.window.overrideOpensAt).toBeNull();
    expect(row.window.overrideExpiresAt).toBeNull();
    expect(row.window.opensAt).not.toBeNull();
    expect(row.window.state).toBe('open');
  });

  it('rejects a timestamp with no offset', async () => {
    const { invitationId } = await scenario({});

    // A bare wall-clock reading means different instants to a recruiter in
    // Bengaluru and a candidate in Berlin.
    await http(app)
      .patch(`/api/invitations/${invitationId}/schedule`)
      .set(auth())
      .send({ opensAt: '01/09/2026 09:00' })
      .expect(400);
  });
});
