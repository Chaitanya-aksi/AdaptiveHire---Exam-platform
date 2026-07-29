import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { E2E_EMAIL_DOMAIN } from './e2e.constants';

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!2345';
export const SEEDED_RECRUITER = 'recruiter@adaptivehire.local';
export const SEEDED_CANDIDATE = 'candidate@adaptivehire.local';

/**
 * Boots the real application with the same global pipes and middleware as
 * `main.ts`, so these tests exercise what actually runs in production.
 *
 * Rate limiting is disabled by default: a suite legitimately calls
 * /auth/register more than the production 5/min allows, and tripping the
 * limiter would make unrelated assertions fail. The limiter itself is proven
 * separately by the suite that passes `{ rateLimiting: true }`.
 */
export async function createTestApp(
  options: { rateLimiting?: boolean } = {},
): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });

  if (!options.rateLimiting) {
    // ThrottlerGuard is bound through APP_GUARD, which `overrideGuard` cannot
    // reach. Swapping the storage it depends on makes every request look like
    // the first hit, so nothing is ever blocked.
    builder.overrideProvider(ThrottlerStorage).useValue({
      increment: () =>
        Promise.resolve({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
    });
  }

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

export const http = (app: INestApplication) =>
  request(app.getHttpServer() as Parameters<typeof request>[0]);

/**
 * Logs in a seeded account. Fails with an actionable message rather than a
 * bare 401 when the database has not been seeded.
 */
export async function loginSeeded(
  app: INestApplication,
  email: string,
): Promise<string> {
  const res = await http(app)
    .post('/api/auth/login')
    .send({ email, password: SEED_PASSWORD });

  if (res.status !== 200) {
    throw new Error(
      `Could not log in as ${email} (HTTP ${res.status}). ` +
        'Run `npm run seed` first — these tests verify a seeded database.',
    );
  }
  return (res.body as { accessToken: string }).accessToken;
}

/**
 * Every account a suite creates must come from here. The `@e2e.local` domain is
 * what the global teardown keys off, so an address built any other way will
 * survive the run.
 */
export const uniqueEmail = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@${E2E_EMAIL_DOMAIN}`;

/**
 * Registration is invite-only, so a test that registers a candidate must first
 * have an invitation for that email. This reuses a seeded assessment as the
 * target (the suites already assume a seeded database) and is idempotent.
 *
 * The invitation is cleaned up with the account it links to — the global
 * teardown deletes @e2e.local users (cascading their invitations) and sweeps
 * any still-unlinked e2e invitations directly.
 */
export async function seedInvitation(
  app: INestApplication,
  email: string,
): Promise<void> {
  const ds = app.get(DataSource);
  const rows = await ds.query<{ id: string }[]>(
    'SELECT id FROM assessments ORDER BY "createdAt" ASC LIMIT 1',
  );
  if (rows.length === 0) {
    throw new Error(
      'No assessment to invite against — run `npm run seed` first.',
    );
  }
  await ds.query(
    `INSERT INTO invitations ("assessmentId", email, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT ("assessmentId", email) DO NOTHING`,
    [rows[0].id, email.toLowerCase()],
  );
}
