import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  SEEDED_CANDIDATE,
  createTestApp,
  http,
  loginSeeded,
  seedInvitation,
  uniqueEmail,
} from './helpers';

/**
 * Acceptance checks for Step 1 (Foundation): infrastructure, the full schema,
 * and JWT auth with role-based access.
 */
describe('Step 1 — Foundation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('infrastructure', () => {
    it('reaches both Postgres and Redis', async () => {
      const res = await http(app).get('/api/health').expect(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        postgres: 'up',
        redis: 'up',
      });
    });
  });

  describe('schema', () => {
    const EXPECTED_TABLES = [
      'assessment_modules',
      'assessment_sessions',
      'assessments',
      'invitations',
      'mcq_question_details',
      'modules',
      'personality_question_details',
      'proctoring_logs',
      'questions',
      'reports',
      'responses',
      'session_module_results',
      'users',
    ];

    it('has every table from the locked schema', async () => {
      const rows = await app
        .get(DataSource)
        .query<{ tablename: string }[]>(
          "SELECT tablename FROM pg_tables WHERE schemaname='public'",
        );
      const present = rows.map((r) => r.tablename);

      for (const table of EXPECTED_TABLES) {
        expect(present).toContain(table);
      }
    });

    it('records applied migrations rather than relying on synchronize', async () => {
      const rows = await app
        .get(DataSource)
        .query<{ name: string }[]>('SELECT name FROM migrations');
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('registration', () => {
    it('creates a candidate and never returns the refresh token in the body', async () => {
      const email = uniqueEmail('reg');
      await seedInvitation(app, email);
      const res = await http(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'Passw0rd!23',
          fullName: 'E2E Candidate',
        })
        .expect(201);

      const body = res.body as Record<string, unknown> & {
        user: { role: string };
      };
      expect(body.user.role).toBe('candidate');
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.refreshToken).toBeUndefined();
    });

    it('sets the refresh token as an httpOnly cookie scoped to /api/auth', async () => {
      const email = uniqueEmail('cookie');
      await seedInvitation(app, email);
      const res = await http(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'Passw0rd!23',
          fullName: 'E2E Cookie',
        })
        .expect(201);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const refresh = cookies.find((c) =>
        c.startsWith('adaptivehire_refresh='),
      );

      expect(refresh).toBeDefined();
      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('Path=/api/auth');
    });

    it('rejects an attempt to self-assign the recruiter_admin role', async () => {
      const res = await http(app)
        .post('/api/auth/register')
        .send({
          email: uniqueEmail('escalate'),
          password: 'Passw0rd!23',
          fullName: 'E2E Escalation',
          role: 'recruiter_admin',
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('role should not exist');
    });

    it('rejects a duplicate email with 409', async () => {
      const email = uniqueEmail('dupe');
      const payload = { email, password: 'Passw0rd!23', fullName: 'E2E Dupe' };

      await seedInvitation(app, email);
      await http(app).post('/api/auth/register').send(payload).expect(201);
      await http(app).post('/api/auth/register').send(payload).expect(409);
    });

    it('rejects a password shorter than 8 characters', async () => {
      await http(app)
        .post('/api/auth/register')
        .send({ email: uniqueEmail('short'), password: 'abc', fullName: 'E2E' })
        .expect(400);
    });

    it('rejects an email that has no invitation with 403 (invite-only)', async () => {
      const res = await http(app)
        .post('/api/auth/register')
        .send({
          email: uniqueEmail('uninvited'),
          password: 'Passw0rd!23',
          fullName: 'E2E Uninvited',
        })
        .expect(403);

      expect(JSON.stringify(res.body)).toContain('has not been invited');
    });
  });

  describe('login and session lifecycle', () => {
    it('rejects a wrong password with 401', async () => {
      await http(app)
        .post('/api/auth/login')
        .send({ email: SEEDED_CANDIDATE, password: 'definitely-wrong' })
        .expect(401);
    });

    it('rejects an unauthenticated request to a protected route', async () => {
      await http(app).get('/api/auth/me').expect(401);
    });

    it('rejects a malformed bearer token', async () => {
      await http(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });

    it('returns the current user for a valid token', async () => {
      const token = await loginSeeded(app, SEEDED_CANDIDATE);
      const res = await http(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toMatchObject({
        email: SEEDED_CANDIDATE,
        role: 'candidate',
      });
    });

    it('rotates tokens on refresh and invalidates them on logout', async () => {
      const email = uniqueEmail('rotate');
      await seedInvitation(app, email);
      const registered = await http(app)
        .post('/api/auth/register')
        .send({ email, password: 'Passw0rd!23', fullName: 'E2E Rotate' })
        .expect(201);

      const cookies = registered.headers['set-cookie'] as unknown as string[];
      const accessToken = (registered.body as { accessToken: string })
        .accessToken;

      const refreshed = await http(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookies)
        .expect(200);
      expect((refreshed.body as { accessToken: string }).accessToken).toEqual(
        expect.any(String),
      );

      await http(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', cookies)
        .expect(204);

      // The cookie is still syntactically valid, but the server-side hash is
      // gone — this is what makes logout actually revoke the session.
      await http(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookies)
        .expect(401);
    });

    it('rejects a refresh with no cookie at all', async () => {
      await http(app).post('/api/auth/refresh').expect(401);
    });
  });

  describe('role-based access control', () => {
    it('blocks a candidate from a recruiter_admin route', async () => {
      const token = await loginSeeded(app, SEEDED_CANDIDATE);
      await http(app)
        .post('/api/modules')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Nope', slug: 'nope', scoringType: 'objective' })
        .expect(403);
    });
  });
});
