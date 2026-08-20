import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTestApp, http, uniqueEmail } from './helpers';
import { E2E_ORG_PREFIX } from './e2e.constants';

/**
 * Self-service password reset.
 *
 * The token itself never leaves the server in a form a test can observe — it is
 * emailed, and only its digest is stored. So these tests mint the token the way
 * the service does (`sha256(token)`) and write the row directly when they need
 * a specific state, and separately assert that the *endpoint* creates a row at
 * all. That keeps the security properties testable without an inbox.
 */

const OLD_PASSWORD = 'OriginalPass!2345';
const NEW_PASSWORD = 'ReplacementPass!2345';

const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');

describe('Step 4 — Password reset', () => {
  let app: INestApplication;
  let ds: DataSource;

  let email: string;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);

    email = uniqueEmail('reset');
    const res = await http(app)
      .post('/api/auth/register')
      .send({
        email,
        password: OLD_PASSWORD,
        fullName: 'Reset Subject',
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}reset ${Date.now()}`,
      })
      .expect(201);

    userId = (res.body as { user: { id: string } }).user.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Writes a token row directly and returns the raw value to present. */
  async function issueToken(
    options: { expiresInMinutes?: number; used?: boolean } = {},
  ): Promise<string> {
    const { expiresInMinutes = 60, used = false } = options;
    const raw = `token-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await ds.query(
      `INSERT INTO password_reset_tokens ("userId", "tokenHash", "expiresAt", "usedAt")
       VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4)`,
      [userId, digest(raw), String(expiresInMinutes), used ? new Date() : null],
    );

    return raw;
  }

  const login = (password: string) =>
    http(app).post('/api/auth/login').send({ email, password });

  // ── Requesting ───────────────────────────────────────────────────────────

  describe('requesting a link', () => {
    it('answers the same for a known and an unknown address', async () => {
      const known = await http(app)
        .post('/api/auth/forgot-password')
        .send({ email });

      const unknown = await http(app)
        .post('/api/auth/forgot-password')
        .send({ email: uniqueEmail('nobody') });

      // Identical status and identical (empty) body: the endpoint must not be
      // usable to find out which addresses have accounts.
      expect(known.status).toBe(204);
      expect(unknown.status).toBe(204);
      expect(known.body).toEqual(unknown.body);
    });

    it('actually records a token for a real account', async () => {
      const before = await ds.query<{ count: string }[]>(
        `SELECT count(*) AS count FROM password_reset_tokens WHERE "userId" = $1`,
        [userId],
      );

      await http(app)
        .post('/api/auth/forgot-password')
        .send({ email })
        .expect(204);

      const after = await ds.query<{ count: string }[]>(
        `SELECT count(*) AS count FROM password_reset_tokens WHERE "userId" = $1`,
        [userId],
      );

      expect(Number(after[0].count)).toBeGreaterThan(Number(before[0].count));
    });

    it('never stores the token in the clear', async () => {
      const rows = await ds.query<{ tokenHash: string }[]>(
        `SELECT "tokenHash" FROM password_reset_tokens WHERE "userId" = $1`,
        [userId],
      );

      // A 64-character hex digest, every time — anything shorter or with other
      // characters in it would mean a raw token had been written.
      for (const row of rows) {
        expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('leaves the previous link working when a new one is asked for', async () => {
      const first = await issueToken();

      await http(app)
        .post('/api/auth/forgot-password')
        .send({ email })
        .expect(204);

      /*
       * This assertion used to be the opposite, and that was the bug.
       *
       * Killing the earlier link on reissue reads as tidy and is a trap in
       * practice: the expired screen offers "send me a new link", which
       * invalidated the link the person still had open in their mail client.
       * They would go back to it, be told it had expired, ask for another, and
       * repeat — every attempt breaking the link they were about to use.
       *
       * Outstanding links now coexist. Each is still single-use and still
       * expires after an hour, and redeeming any one of them burns the rest —
       * which is the point where invalidating actually protects something, and
       * is asserted separately below.
       */
      await http(app)
        .post('/api/auth/reset-password')
        .send({ token: first, password: NEW_PASSWORD })
        .expect(204);
    });

    it('rejects a malformed address before doing anything', async () => {
      await http(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'not-an-address' })
        .expect(400);
    });
  });

  // ── Redeeming ────────────────────────────────────────────────────────────

  describe('redeeming a link', () => {
    it('refuses an unknown token', async () => {
      await http(app)
        .post('/api/auth/reset-password')
        .send({ token: 'never-issued', password: NEW_PASSWORD })
        .expect(400);
    });

    it('refuses an expired token', async () => {
      const token = await issueToken({ expiresInMinutes: -1 });

      await http(app)
        .post('/api/auth/reset-password')
        .send({ token, password: NEW_PASSWORD })
        .expect(400);
    });

    it('refuses a token that has already been used', async () => {
      const token = await issueToken({ used: true });

      await http(app)
        .post('/api/auth/reset-password')
        .send({ token, password: NEW_PASSWORD })
        .expect(400);
    });

    it('refuses a password below the registration floor', async () => {
      const token = await issueToken();

      await http(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'short' })
        .expect(400);
    });

    it('gives the same message whatever the reason', async () => {
      const unknown = await http(app)
        .post('/api/auth/reset-password')
        .send({ token: 'never-issued', password: NEW_PASSWORD });

      const expired = await http(app)
        .post('/api/auth/reset-password')
        .send({
          token: await issueToken({ expiresInMinutes: -1 }),
          password: NEW_PASSWORD,
        });

      // Distinguishing the two would tell someone holding a guessed value which
      // part of the guess was right.
      expect((unknown.body as { message: string }).message).toEqual(
        (expired.body as { message: string }).message,
      );
    });

    it('sets the new password and burns the token', async () => {
      const token = await issueToken();

      await http(app)
        .post('/api/auth/reset-password')
        .send({ token, password: NEW_PASSWORD })
        .expect(204);

      await login(NEW_PASSWORD).expect(200);
      await login(OLD_PASSWORD).expect(401);

      // Single use: the same link cannot be replayed.
      await http(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'YetAnotherPass!2345' })
        .expect(400);
    });

    it('burns every other outstanding link', async () => {
      // The security half of the rule above: once one link has changed the
      // password, any other still sitting in an inbox is a way to change it
      // again without knowing the new one.
      const spare = await issueToken();
      const used = await issueToken();

      await http(app)
        .post('/api/auth/reset-password')
        .send({ token: used, password: NEW_PASSWORD })
        .expect(204);

      await http(app)
        .post('/api/auth/reset-password')
        .send({ token: spare, password: 'ShouldNotWork!2345' })
        .expect(400);
    });

    it('clears mustChangePassword', async () => {
      await ds.query(
        `UPDATE users SET "mustChangePassword" = true WHERE id = $1`,
        [userId],
      );

      const token = await issueToken();
      await http(app)
        .post('/api/auth/reset-password')
        .send({ token, password: NEW_PASSWORD })
        .expect(204);

      const rows = await ds.query<{ mustChangePassword: boolean }[]>(
        `SELECT "mustChangePassword" FROM users WHERE id = $1`,
        [userId],
      );
      expect(rows[0].mustChangePassword).toBe(false);
    });

    it('signs out sessions that were already open', async () => {
      // A reset is what someone does when they believe another person has their
      // password. Leaving that person signed in would defeat it.
      const signedIn = await login(NEW_PASSWORD).expect(200);
      const cookie = signedIn.headers['set-cookie'];

      const token = await issueToken();
      await http(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'FreshAfterReset!2345' })
        .expect(204);

      await http(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookie)
        .expect(401);
    });
  });
});
