import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { createTestApp, http, uniqueEmail } from './helpers';
import { E2E_ORG_PREFIX } from './e2e.constants';
import {
  INVITE_EMAILS_QUEUE,
  type OutboundEmailJob,
} from '../src/queues/invite-emails/invite-emails.job';
import { ReportsService } from '../src/reports/reports.service';

/**
 * Completion notifications.
 *
 * Two things worth holding still. The email must reach whoever owns the
 * requisition even after the person who set it up has left, and it must carry
 * no result — a score read in an inbox is a score read without the cohort, the
 * proctoring context or the answers, which is exactly what the report exists to
 * put around it.
 */

const PASSWORD = 'Notify!2345';

describe('Step 12 — Completion notifications', () => {
  let app: INestApplication;
  let ds: DataSource;
  let reports: ReportsService;

  let ownerToken: string;
  let ownerEmail: string;
  let moduleId: string;
  let assessmentId: string;
  let candidateId: string;

  /** Every job the service pushed onto the mail queue. */
  const queued: OutboundEmailJob[] = [];

  const auth = () => ({ Authorization: `Bearer ${ownerToken}` });

  async function makeSession(): Promise<string> {
    const invite = await ds.query<{ id: string }[]>(
      `INSERT INTO invitations ("assessmentId", email, status, "candidateId")
       VALUES ($1, $2, 'completed', $3) RETURNING id`,
      [assessmentId, uniqueEmail('notify-inv'), candidateId],
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
       VALUES ($1,$2,1100,10,7)`,
      [session[0].id, moduleId],
    );
    return session[0].id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    reports = app.get(ReportsService);

    /*
     * Wrap the real queue rather than replacing the provider: the processor is
     * a live worker, and swapping the provider leaves the app unable to close.
     *
     * A plain lookup is correct because the queue is registered exactly once,
     * in MailQueueModule.
     */
    const queue = app.get<Queue<OutboundEmailJob>>(
      getQueueToken(INVITE_EMAILS_QUEUE),
    );
    const realAdd = queue.add.bind(queue);
    queue.add = ((name: string, data: OutboundEmailJob, opts?: unknown) => {
      queued.push(data);
      return realAdd(name, data, opts as Parameters<typeof realAdd>[2]);
    }) as Queue<OutboundEmailJob>['add'];

    ownerEmail = uniqueEmail('notify-owner');
    const owner = await http(app)
      .post('/api/auth/register')
      .send({
        email: ownerEmail,
        password: PASSWORD,
        fullName: 'Notify Owner',
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}notify ${Date.now()}`,
      })
      .expect(201);
    ownerToken = (owner.body as { accessToken: string }).accessToken;

    const modules = await http(app).get('/api/modules').set(auth()).expect(200);
    moduleId = (modules.body as { id: string; slug: string }[]).find(
      (m) => m.slug === 'aptitude',
    )!.id;

    const assessment = await http(app)
      .post('/api/assessments')
      .set(auth())
      .send({
        title: 'Notify assessment',
        modules: [
          { moduleId, minQuestions: 1, maxQuestions: 5, timeLimitSeconds: 600 },
        ],
      })
      .expect(201);
    assessmentId = (assessment.body as { id: string }).id;

    const candidate = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, "passwordHash", "fullName", role)
       VALUES ($1, 'x', 'Notify Candidate', 'candidate') RETURNING id`,
      [uniqueEmail('notify-cand')],
    );
    candidateId = candidate[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const notices = () =>
    queued.filter(
      (job): job is Extract<OutboundEmailJob, { kind: 'attempt-completed' }> =>
        job.kind === 'attempt-completed',
    );

  it('emails the person who set the assessment up', async () => {
    queued.length = 0;
    const sessionId = await makeSession();

    await reports.generate(sessionId);

    const sent = notices();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(ownerEmail);
    expect(sent[0].candidateName).toBe('Notify Candidate');
    expect(sent[0].assessmentTitle).toBe('Notify assessment');
  });

  it('links straight to that candidate’s report', async () => {
    queued.length = 0;
    const sessionId = await makeSession();

    await reports.generate(sessionId);

    const url = new URL(notices()[0].reportUrl);
    expect(url.pathname).toBe(`/admin/reports/${sessionId}`);
  });

  it('carries no score, recommendation or percentile', async () => {
    queued.length = 0;
    const sessionId = await makeSession();

    await reports.generate(sessionId);

    // The point of the report is everything that sits *around* a number. An
    // email that leads with the number invites the decision to be made without
    // any of it.
    const serialised = JSON.stringify(notices()[0]).toLowerCase();
    for (const leak of [
      'score',
      'percentile',
      'recommend',
      'ability',
      'behavioural',
    ]) {
      expect(serialised).not.toContain(leak);
    }
  });

  it('still notifies somebody when the creator’s account is gone', async () => {
    // `assessments.createdById` is SET NULL, so deleting a departed colleague
    // would otherwise switch off notifications for everything they set up.
    await ds.query(
      `UPDATE assessments SET "createdById" = NULL WHERE id = $1`,
      [assessmentId],
    );

    queued.length = 0;
    const sessionId = await makeSession();
    await reports.generate(sessionId);

    const sent = notices();
    expect(sent).toHaveLength(1);
    // Falls back to an owner of the organisation.
    expect(sent[0].to).toBe(ownerEmail);
  });

  it('does not fail report generation when there is nobody to notify', async () => {
    // Belt and braces on the "a mail problem must never break a report" rule.
    await ds.query(`UPDATE users SET "isActive" = false WHERE email = $1`, [
      ownerEmail,
    ]);

    queued.length = 0;
    const sessionId = await makeSession();

    // The report is what matters; the notification is a convenience.
    await expect(reports.generate(sessionId)).resolves.toBeTruthy();
    expect(notices()).toHaveLength(0);

    await ds.query(`UPDATE users SET "isActive" = true WHERE email = $1`, [
      ownerEmail,
    ]);
  });
});
