import { INestApplication } from '@nestjs/common';
import { createTestApp, http, uniqueEmail } from './helpers';

/**
 * The one suite that runs with the real ThrottlerGuard in place, proving the
 * brute-force protection on the auth routes actually fires. Every other suite
 * disables it so its own assertions aren't masked by 429s.
 */
describe('Step 1 — auth rate limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ rateLimiting: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 429 once repeated login attempts exceed the limit', async () => {
    const attempt = () =>
      http(app)
        .post('/api/auth/login')
        .send({ email: uniqueEmail('bruteforce'), password: 'wrong-password' });

    const statuses: number[] = [];
    // The configured cap is 10/min; 15 tries must run into it.
    for (let i = 0; i < 15; i += 1) {
      statuses.push((await attempt()).status);
    }

    expect(statuses).toContain(401); // early attempts are simply wrong
    expect(statuses).toContain(429); // later ones are refused outright
    expect(statuses[statuses.length - 1]).toBe(429);
  });
});
