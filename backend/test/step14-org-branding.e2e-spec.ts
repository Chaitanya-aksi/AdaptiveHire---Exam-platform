import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { createTestApp, http, uniqueEmail } from './helpers';
import { E2E_ORG_PREFIX } from './e2e.constants';

/**
 * Per-organisation branding.
 *
 * The interesting property is not that a colour round-trips — it is that
 * branding follows the *invitation*. A candidate belongs to no organisation and
 * may be assessed by several at once, so a portal branded to "the candidate's
 * company" would be branded to the wrong one for everybody after the first.
 */

const PASSWORD = 'Branding!2345';

/**
 * Set before the app boots so the fallback chain in `brandingOf` is exercised
 * for real: an organisation with its own address must win over this, and one
 * without must land on it.
 */
const PLATFORM_SUPPORT = 'platform-help@adaptivehire.test';

describe('Step 14 — Organisation branding', () => {
  let app: INestApplication;
  let ds: DataSource;
  let previousSupportEmail: string | undefined;

  /** Two companies assessing the same person. */
  const org: Record<'a' | 'b', { token: string; assessmentId: string }> =
    {} as never;

  let moduleId: string;
  let candidateEmail: string;
  let candidateToken: string;

  const auth = (which: 'a' | 'b') => ({
    Authorization: `Bearer ${org[which].token}`,
  });

  async function setUpOrg(label: 'a' | 'b', name: string): Promise<void> {
    const registered = await http(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail(`brand-${label}`),
        password: PASSWORD,
        fullName: `Brand ${label}`,
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}${name} ${Date.now()}`,
      })
      .expect(201);

    org[label] = {
      token: (registered.body as { accessToken: string }).accessToken,
      assessmentId: '',
    };

    const assessment = await http(app)
      .post('/api/assessments')
      .set(auth(label))
      .send({
        title: `${name} assessment`,
        modules: [{ moduleId, questionCount: 3, timeLimitSeconds: 600 }],
      })
      .expect(201);
    org[label].assessmentId = (assessment.body as { id: string }).id;

    await http(app)
      .post(`/api/assessments/${org[label].assessmentId}/invitations`)
      .set(auth(label))
      .send({ email: candidateEmail, fullName: 'Shared Candidate' })
      .expect(201);
  }

  beforeAll(async () => {
    // Before createTestApp: configuration is read once at boot, so setting this
    // afterwards would have no effect. Restored in afterAll because the suites
    // share a process.
    previousSupportEmail = process.env.SUPPORT_EMAIL;
    process.env.SUPPORT_EMAIL = PLATFORM_SUPPORT;

    app = await createTestApp();
    ds = app.get(DataSource);

    // A throwaway org just to read the module catalogue before the two under
    // test exist.
    const bootstrap = await http(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail('brand-boot'),
        password: PASSWORD,
        fullName: 'Boot',
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}brand-boot ${Date.now()}`,
      })
      .expect(201);

    const modules = await http(app)
      .get('/api/modules')
      .set({
        Authorization: `Bearer ${(bootstrap.body as { accessToken: string }).accessToken}`,
      })
      .expect(200);
    moduleId = (modules.body as { id: string; slug: string }[]).find(
      (m) => m.slug === 'aptitude',
    )!.id;

    candidateEmail = uniqueEmail('brand-cand');

    await setUpOrg('a', 'brand-alpha');
    await setUpOrg('b', 'brand-beta');

    // The invite provisioned the account with a generated password; set a known
    // one so the candidate side can be exercised.
    await ds.query(
      `UPDATE users SET "passwordHash" = $1, "mustChangePassword" = false WHERE email = $2`,
      [await argon2.hash(PASSWORD), candidateEmail],
    );
    const signedIn = await http(app)
      .post('/api/auth/login')
      .send({ email: candidateEmail, password: PASSWORD })
      .expect(200);
    candidateToken = (signedIn.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app?.close();

    if (previousSupportEmail === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = previousSupportEmail;
  });

  const myInvitations = async () => {
    const res = await http(app)
      .get('/api/me/invitations')
      .set({ Authorization: `Bearer ${candidateToken}` })
      .expect(200);
    return res.body as {
      id: string;
      assessment: { title: string };
      organisation: {
        name: string;
        logoUrl: string | null;
        accentColor: string | null;
        supportEmail: string | null;
      };
    }[];
  };

  it('stores a logo and accent for the caller’s own workspace', async () => {
    const res = await http(app)
      .patch('/api/organisations/mine/branding')
      .set(auth('a'))
      .send({
        logoUrl: 'https://cdn.example.com/alpha.png',
        accentColor: '#aa3311',
      })
      .expect(200);

    expect(res.body).toMatchObject({
      logoUrl: 'https://cdn.example.com/alpha.png',
      accentColor: '#aa3311',
    });
  });

  it('brands each invitation by the company that sent it', async () => {
    await http(app)
      .patch('/api/organisations/mine/branding')
      .set(auth('b'))
      .send({ accentColor: '#0055cc' })
      .expect(200);

    const invitations = await myInvitations();
    const alpha = invitations.find((i) =>
      i.assessment.title.startsWith('brand-alpha'),
    )!;
    const beta = invitations.find((i) =>
      i.assessment.title.startsWith('brand-beta'),
    )!;

    // The whole point: one candidate, two companies, two brands. A portal
    // branded to "their" organisation would be wrong for one of these.
    expect(alpha.organisation.accentColor).toBe('#aa3311');
    expect(alpha.organisation.logoUrl).toBe(
      'https://cdn.example.com/alpha.png',
    );
    expect(beta.organisation.accentColor).toBe('#0055cc');
    expect(beta.organisation.logoUrl).toBeNull();
  });

  it('brands the attempt detail page the same way', async () => {
    const invitations = await myInvitations();
    const alpha = invitations.find((i) =>
      i.assessment.title.startsWith('brand-alpha'),
    )!;

    const res = await http(app)
      .get(`/api/me/invitations/${alpha.id}`)
      .set({ Authorization: `Bearer ${candidateToken}` })
      .expect(200);

    expect(
      (res.body as { organisation: { accentColor: string } }).organisation
        .accentColor,
    ).toBe('#aa3311');
  });

  it('never exposes the organisation’s id or slug to a candidate', async () => {
    const invitations = await myInvitations();

    // Narrowed on purpose: a candidate has no business knowing either, and
    // passing the entity straight through would leak both.
    expect(Object.keys(invitations[0].organisation).sort()).toEqual([
      'accentColor',
      'logoUrl',
      'name',
      'supportEmail',
    ]);
  });

  it('clears branding when null is sent', async () => {
    await http(app)
      .patch('/api/organisations/mine/branding')
      .set(auth('a'))
      .send({ logoUrl: null })
      .expect(200);

    const invitations = await myInvitations();
    const alpha = invitations.find((i) =>
      i.assessment.title.startsWith('brand-alpha'),
    )!;

    expect(alpha.organisation.logoUrl).toBeNull();
    // The colour is untouched — omitting a field must not reset it.
    expect(alpha.organisation.accentColor).toBe('#aa3311');
  });

  it('rejects a colour that is not a hex triplet', async () => {
    // This value is interpolated into a stylesheet on a page candidates sign
    // in to, so "any string the customer types" must not reach it.
    for (const bad of ['red', 'javascript:alert(1)', '#fff', '#12345g']) {
      await http(app)
        .patch('/api/organisations/mine/branding')
        .set(auth('a'))
        .send({ accentColor: bad })
        .expect(400);
    }
  });

  it('rejects a non-https logo URL', async () => {
    // http would be blocked as mixed content on the portal, so accepting it
    // would store a logo that can never appear.
    await http(app)
      .patch('/api/organisations/mine/branding')
      .set(auth('a'))
      .send({ logoUrl: 'http://cdn.example.com/alpha.png' })
      .expect(400);
  });

  /*
   * The support address a candidate is given when an assessment goes wrong.
   *
   * It resolves through a chain — the inviting organisation's own address, then
   * the platform's, then null — and the chain runs on the server so the client
   * is handed an address or nothing, never the job of choosing. Each link is
   * covered below, because the UI renders a contact route if and only if this
   * is non-null and a wrong link means either a dead mailto or no route at all
   * for somebody who has just lost an attempt.
   */

  it('prefers the inviting organisation’s own support address', async () => {
    await http(app)
      .patch('/api/organisations/mine/branding')
      .set(auth('a'))
      .send({ supportEmail: 'alpha-help@example.com' })
      .expect(200);

    const invitations = await myInvitations();
    const alpha = invitations.find((i) =>
      i.assessment.title.startsWith('brand-alpha'),
    )!;
    const beta = invitations.find((i) =>
      i.assessment.title.startsWith('brand-beta'),
    )!;

    // Alpha set one; beta did not and falls through to the platform's. The
    // company that invited them is the only one that can re-run their attempt,
    // so it has to win — and it does so per invitation, not per viewer.
    expect(alpha.organisation.supportEmail).toBe('alpha-help@example.com');
    expect(beta.organisation.supportEmail).toBe(PLATFORM_SUPPORT);
  });

  it('carries the resolved address onto the attempt detail page', async () => {
    const invitations = await myInvitations();
    const alpha = invitations.find((i) =>
      i.assessment.title.startsWith('brand-alpha'),
    )!;

    const res = await http(app)
      .get(`/api/me/invitations/${alpha.id}`)
      .set({ Authorization: `Bearer ${candidateToken}` })
      .expect(200);

    // The attempt page is where an interrupted candidate actually lands, so
    // the address missing here would make the whole feature unreachable.
    expect(
      (res.body as { organisation: { supportEmail: string } }).organisation
        .supportEmail,
    ).toBe('alpha-help@example.com');
  });

  it('shows a recruiter their own unset address rather than the fallback', async () => {
    const res = await http(app)
      .get('/api/organisations/mine')
      .set(auth('b'))
      .expect(200);

    // Resolved for candidates, raw for the recruiter editing it — otherwise the
    // settings form would show the platform address and imply it was theirs.
    expect(
      (res.body as { supportEmail: string | null }).supportEmail,
    ).toBeNull();
  });

  it('rejects a support address that is not an email', async () => {
    for (const bad of ['not-an-email', 'mailto:help@example.com', 'a@b']) {
      await http(app)
        .patch('/api/organisations/mine/branding')
        .set(auth('a'))
        .send({ supportEmail: bad })
        .expect(400);
    }
  });

  it('falls back to the platform address when the organisation clears its own', async () => {
    await http(app)
      .patch('/api/organisations/mine/branding')
      .set(auth('a'))
      .send({ supportEmail: null })
      .expect(200);

    const invitations = await myInvitations();
    const alpha = invitations.find((i) =>
      i.assessment.title.startsWith('brand-alpha'),
    )!;

    expect(alpha.organisation.supportEmail).toBe(PLATFORM_SUPPORT);
  });

  it('is refused to a candidate outright', async () => {
    await http(app)
      .patch('/api/organisations/mine/branding')
      .set({ Authorization: `Bearer ${candidateToken}` })
      .send({ accentColor: '#000000' })
      .expect(403);
  });
});
