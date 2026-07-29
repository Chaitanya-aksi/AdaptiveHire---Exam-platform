import { INestApplication } from '@nestjs/common';
import { createTestApp, http, seedInvitation, uniqueEmail } from './helpers';

const register = async (app: INestApplication) => {
  const email = uniqueEmail('rotation');
  // Registration is invite-only now, so give this address an invitation first.
  await seedInvitation(app, email);
  const res = await http(app)
    .post('/api/auth/register')
    .send({
      email,
      password: 'Passw0rd!23',
      fullName: 'E2E Rotation',
    })
    .expect(201);

  return {
    cookies: res.headers['set-cookie'] as unknown as string[],
    accessToken: (res.body as { accessToken: string }).accessToken,
  };
};

const cookiesOf = (res: { headers: Record<string, unknown> }) =>
  res.headers['set-cookie'] as string[];

describe('Step 1 — refresh token rotation and grace window', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rotates the token on every refresh', async () => {
    const { cookies } = await register(app);

    const first = await http(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);

    // A brand new cookie must come back, not the one that was sent.
    expect(cookiesOf(first).join()).not.toEqual(cookies.join());
  });

  /**
   * The bug this guards against: a page reload that starts before the previous
   * refresh's Set-Cookie lands presents a one-generation-stale token. Without
   * a grace window that was treated as theft and signed the user out — which
   * showed up as random logouts during rapid navigation.
   */
  it('accepts the previous token inside the grace window', async () => {
    const { cookies } = await register(app);

    await http(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);

    // Same stale cookie again — this is the reload race, not an attack.
    await http(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);
  });

  it('tolerates a burst of reloads all carrying the same stale cookie', async () => {
    const { cookies } = await register(app);
    await http(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);

    const statuses = await Promise.all(
      Array.from({ length: 5 }, () =>
        http(app)
          .post('/api/auth/refresh')
          .set('Cookie', cookies)
          .then((r) => r.status),
      ),
    );

    expect(statuses).toEqual([200, 200, 200, 200, 200]);
  });

  /**
   * The case a single previous-token slot could not cover, and the one that
   * actually signed people out: rapid navigation leaves the browser holding a
   * token that was issued but skipped over, so it is neither the current token
   * nor the immediately-preceding one.
   */
  it('accepts a token that was issued but never used', async () => {
    const { cookies: c1 } = await register(app);

    // c1 -> c2 (c2 is handed out but the client never gets to use it)
    const second = await http(app)
      .post('/api/auth/refresh')
      .set('Cookie', c1)
      .expect(200);
    const c2 = cookiesOf(second);

    // A racing reload still holding c1 moves the chain on to c3.
    await http(app).post('/api/auth/refresh').set('Cookie', c1).expect(200);

    // c2 is now two generations behind, but was legitimately issued.
    await http(app).post('/api/auth/refresh').set('Cookie', c2).expect(200);
  });

  it('survives a long chain of interleaved stale tokens', async () => {
    const { cookies } = await register(app);

    let current = cookies;
    const issued: string[][] = [cookies];

    for (let i = 0; i < 4; i += 1) {
      const res = await http(app)
        .post('/api/auth/refresh')
        .set('Cookie', current)
        .expect(200);
      current = cookiesOf(res);
      issued.push(current);
    }

    // Every generation still inside the window remains usable.
    for (const cookie of issued.slice(-3)) {
      await http(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookie)
        .expect(200);
    }
  });

  it('revokes the session when a token that was never current is presented', async () => {
    const { cookies: firstSession } = await register(app);

    // Signing in again starts a fresh chain, orphaning the first token.
    const secondSession = await http(app)
      .post('/api/auth/refresh')
      .set('Cookie', firstSession)
      .expect(200);

    const liveCookies = cookiesOf(secondSession);

    // Forge a cookie carrying a token this user was never issued.
    const forged = [
      'adaptivehire_refresh=not-a-token-we-issued; Path=/api/auth',
    ];
    await http(app).post('/api/auth/refresh').set('Cookie', forged).expect(401);

    // The live session must survive an unrelated forged attempt.
    await http(app)
      .post('/api/auth/refresh')
      .set('Cookie', liveCookies)
      .expect(200);
  });

  it('rejects a refresh once the user has logged out', async () => {
    const { cookies, accessToken } = await register(app);

    await http(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', cookies)
      .expect(204);

    // Logout clears the grace slot too, so the window cannot resurrect it.
    await http(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies)
      .expect(401);
  });
});

describe('Step 1 — refresh grace window disabled', () => {
  let app: INestApplication;
  const original = process.env.AUTH_REFRESH_GRACE_SECONDS;

  beforeAll(async () => {
    // 0 restores strict single-use rotation.
    process.env.AUTH_REFRESH_GRACE_SECONDS = '0';
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    process.env.AUTH_REFRESH_GRACE_SECONDS = original;
  });

  it('rejects the previous token immediately', async () => {
    const { cookies } = await register(app);

    await http(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);
    await http(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies)
      .expect(401);
  });
});
