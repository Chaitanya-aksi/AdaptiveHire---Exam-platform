import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { createTestApp, http, uniqueEmail } from './helpers';
import { E2E_ORG_PREFIX } from './e2e.constants';
import {
  INVITE_EMAILS_QUEUE,
  type OutboundEmailJob,
} from '../src/queues/invite-emails/invite-emails.job';

/**
 * The link in the email, end to end.
 *
 * Every other reset test writes its own token row and then redeems it, which
 * proves each half works but never that they *join up*. The join is exactly
 * where this flow broke in practice — issuing a link quietly invalidated the
 * one already sitting in the user's inbox, so every link they clicked reported
 * itself expired while both halves passed their own tests.
 *
 * So this suite takes the URL out of the real queued job, parses it the way a
 * browser would, and redeems what comes out.
 */

const PASSWORD = 'RoundTrip!2345';

describe('Step 6 — Reset link round trip', () => {
  let app: INestApplication;
  let email: string;

  /** Reset links captured from the queue, oldest first. */
  const links: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();

    /*
     * Wrapping the real queue's `add` rather than replacing the provider: the
     * processor for this queue is a live BullMQ worker, and swapping the
     * provider out from under it leaves the app unable to shut down.
     *
     * A plain `app.get` is correct *because* the queue is registered exactly
     * once, in `MailQueueModule`. It briefly was not: three modules each called
     * `registerQueue` for the same name, which creates one `Queue` object per
     * module, and this spy sat on an instance nobody enqueued to — the tests
     * read as "the reset flow is broken" when it was working perfectly.
     */
    const queue = app.get<Queue<OutboundEmailJob>>(
      getQueueToken(INVITE_EMAILS_QUEUE),
    );
    const realAdd = queue.add.bind(queue);

    queue.add = ((name: string, data: OutboundEmailJob, opts?: unknown) => {
      if (data.kind === 'password-reset') links.push(data.resetUrl);
      return realAdd(name, data, opts as Parameters<typeof realAdd>[2]);
    }) as Queue<OutboundEmailJob>['add'];

    email = uniqueEmail('roundtrip');
    await http(app)
      .post('/api/auth/register')
      .send({
        email,
        password: PASSWORD,
        fullName: 'Round Trip',
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}roundtrip ${Date.now()}`,
      })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Requests a link and returns the token from the URL that was emailed. */
  async function requestLink(): Promise<string> {
    const before = links.length;

    await http(app)
      .post('/api/auth/forgot-password')
      .send({ email })
      .expect(204);

    const url = links[before];
    expect(url).toBeDefined();

    // Parsed the way a browser hands it to the page: `URL` decodes percent
    // escapes in the query exactly as `URLSearchParams` does in the app.
    const token = new URL(url).searchParams.get('token');
    expect(token).toBeTruthy();
    return token!;
  }

  it('emails a link that actually redeems', async () => {
    const token = await requestLink();
    const newPassword = 'AfterRoundTrip!2345';

    await http(app)
      .post('/api/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(204);

    // The proof the whole chain held: the password it set is the one that now
    // signs in.
    await http(app)
      .post('/api/auth/login')
      .send({ email, password: newPassword })
      .expect(200);
  });

  it('points the link at the route the frontend serves', async () => {
    const before = links.length;
    await http(app)
      .post('/api/auth/forgot-password')
      .send({ email })
      .expect(204);

    const url = new URL(links[before]);
    expect(url.pathname).toBe('/reset-password');

    // base64url by construction — anything outside this set would have to
    // survive percent-encoding and decoding intact, and the cheapest guarantee
    // is not to emit it at all.
    expect(url.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('leaves an earlier link working when a newer one is requested', async () => {
    // The bug this whole suite exists for. Someone asks for a link, does not
    // see it arrive, asks again — and the first email, which turns up a moment
    // later, has to still work. Killing it on reissue turned the "send me a new
    // link" button into a way to break the link you were about to click.
    const first = await requestLink();
    const second = await requestLink();

    expect(first).not.toEqual(second);

    await http(app)
      .post('/api/auth/reset-password')
      .send({ token: first, password: 'OlderLinkStillWorks!2345' })
      .expect(204);
  });

  it('burns every outstanding link once one of them is used', async () => {
    // The other half of the rule. Coexisting links are fine until one is
    // redeemed; after that the rest are a way to change the password again
    // without knowing the new one.
    const first = await requestLink();
    const second = await requestLink();

    await http(app)
      .post('/api/auth/reset-password')
      .send({ token: second, password: 'RedeemedTheSecond!2345' })
      .expect(204);

    await http(app)
      .post('/api/auth/reset-password')
      .send({ token: first, password: 'ShouldNotWork!2345' })
      .expect(400);

    // And the password is the one set by the link that was actually used.
    await http(app)
      .post('/api/auth/login')
      .send({ email, password: 'RedeemedTheSecond!2345' })
      .expect(200);
  });
});
