import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp, http, uniqueEmail } from './helpers';
import { E2E_ORG_PREFIX } from './e2e.constants';
import { OrgRole } from '../src/common/enums';

/**
 * Roles inside an organisation.
 *
 * Everyone in a workspace used to be able to do everything — delete any
 * assessment, read any report, remove any colleague. This is access control, so
 * the tests are written the way access control fails: each role is checked for
 * what it must be able to do *and* what it must not, because a ladder that only
 * ever grants is not a ladder.
 */

const PASSWORD = 'OrgRoles!2345';

describe('Step 11 — Organisation roles', () => {
  let app: INestApplication;
  let ds: DataSource;

  /** One signed-in token per role, all in the same workspace. */
  const token: Record<OrgRole, string> = {} as Record<OrgRole, string>;
  const userId: Record<OrgRole, string> = {} as Record<OrgRole, string>;

  let moduleId: string;
  let assessmentId: string;
  let questionId: string;

  const auth = (role: OrgRole) => ({ Authorization: `Bearer ${token[role]}` });

  /**
   * Provisions a colleague at the given role and signs them in.
   *
   * Goes through the real endpoints rather than writing rows, so the roles
   * under test are ones the product can actually produce.
   */
  async function addColleague(role: OrgRole): Promise<void> {
    const email = uniqueEmail(`role-${role}`);

    const created = await http(app)
      .post('/api/users')
      .set(auth(OrgRole.OWNER))
      .send({ email, fullName: `Role ${role}`, role: 'recruiter_admin' })
      .expect(201);

    const { user, temporaryPassword } = created.body as {
      user: { id: string };
      temporaryPassword: string;
    };
    userId[role] = user.id;

    if (role !== OrgRole.HIRING_MANAGER) {
      // Provisioning defaults to hiring_manager; move them where they belong.
      await http(app)
        .patch(`/api/users/${user.id}/org-role`)
        .set(auth(OrgRole.OWNER))
        .send({ orgRole: role })
        .expect(200);
    }

    const signedIn = await http(app)
      .post('/api/auth/login')
      .send({ email, password: temporaryPassword })
      .expect(200);

    token[role] = (signedIn.body as { accessToken: string }).accessToken;
  }

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);

    const owner = await http(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail('role-owner'),
        password: PASSWORD,
        fullName: 'Role Owner',
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}roles ${Date.now()}`,
      })
      .expect(201);

    const body = owner.body as {
      accessToken: string;
      user: { id: string };
    };
    token[OrgRole.OWNER] = body.accessToken;
    userId[OrgRole.OWNER] = body.user.id;

    await addColleague(OrgRole.ADMIN);
    await addColleague(OrgRole.HIRING_MANAGER);
    await addColleague(OrgRole.VIEWER);

    const modules = await http(app)
      .get('/api/modules')
      .set(auth(OrgRole.OWNER))
      .expect(200);
    moduleId = (modules.body as { id: string; slug: string }[]).find(
      (m) => m.slug === 'aptitude',
    )!.id;

    const assessment = await http(app)
      .post('/api/assessments')
      .set(auth(OrgRole.OWNER))
      .send({
        title: 'Roles assessment',
        modules: [{ moduleId, questionCount: 5, timeLimitSeconds: 600 }],
      })
      .expect(201);
    assessmentId = (assessment.body as { id: string }).id;

    const question = await http(app)
      .post('/api/questions')
      .set(auth(OrgRole.OWNER))
      .send({
        moduleId,
        questionText: 'E2E roles question',
        tags: ['e2e'],
        mcq: {
          options: [
            { key: 'A', text: '1' },
            { key: 'B', text: '2' },
            { key: 'C', text: '3' },
            { key: 'D', text: '4' },
          ],
          correctOption: 'B',
          difficultyScore: 900,
        },
      })
      .expect(201);
    questionId = (question.body as { id: string }).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── Reading ──────────────────────────────────────────────────────────────

  describe('everyone in the workspace can read', () => {
    it.each([OrgRole.VIEWER, OrgRole.HIRING_MANAGER, OrgRole.ADMIN])(
      'lets a %s list assessments',
      async (role) => {
        await http(app).get('/api/assessments').set(auth(role)).expect(200);
      },
    );

    it.each([OrgRole.VIEWER, OrgRole.HIRING_MANAGER, OrgRole.ADMIN])(
      'lets a %s read the question bank',
      async (role) => {
        await http(app).get('/api/questions').set(auth(role)).expect(200);
      },
    );
  });

  // ── Viewer ───────────────────────────────────────────────────────────────

  describe('a viewer changes nothing', () => {
    it('cannot create an assessment', async () => {
      await http(app)
        .post('/api/assessments')
        .set(auth(OrgRole.VIEWER))
        .send({
          title: 'Nope',
          modules: [
            {
              moduleId,
              questionCount: 3,
              timeLimitSeconds: 600,
            },
          ],
        })
        .expect(403);
    });

    it('cannot invite a candidate', async () => {
      await http(app)
        .post(`/api/assessments/${assessmentId}/invitations`)
        .set(auth(OrgRole.VIEWER))
        .send({ email: uniqueEmail('nope'), fullName: 'Nope' })
        .expect(403);
    });

    it('cannot edit the question bank', async () => {
      await http(app)
        .patch(`/api/questions/${questionId}`)
        .set(auth(OrgRole.VIEWER))
        .send({ questionText: 'Rewritten by a viewer' })
        .expect(403);
    });
  });

  // ── Hiring manager ───────────────────────────────────────────────────────

  describe('a hiring manager runs requisitions but not the workspace', () => {
    it('can create an assessment', async () => {
      await http(app)
        .post('/api/assessments')
        .set(auth(OrgRole.HIRING_MANAGER))
        .send({
          title: 'HM assessment',
          modules: [
            {
              moduleId,
              questionCount: 3,
              timeLimitSeconds: 600,
            },
          ],
        })
        .expect(201);
    });

    it('can invite a candidate', async () => {
      await http(app)
        .post(`/api/assessments/${assessmentId}/invitations`)
        .set(auth(OrgRole.HIRING_MANAGER))
        .send({ email: uniqueEmail('hm-invite'), fullName: 'HM Invite' })
        .expect(201);
    });

    it('cannot edit the shared question bank', async () => {
      // One person's edit changes every future assessment in the workspace, so
      // it is not a per-requisition decision.
      await http(app)
        .patch(`/api/questions/${questionId}`)
        .set(auth(OrgRole.HIRING_MANAGER))
        .send({ questionText: 'Rewritten by a hiring manager' })
        .expect(403);
    });

    it('cannot delete an assessment', async () => {
      // Deleting one destroys every attempt made on it.
      await http(app)
        .delete(`/api/assessments/${assessmentId}`)
        .set(auth(OrgRole.HIRING_MANAGER))
        .expect(403);
    });

    it('cannot add or remove colleagues', async () => {
      await http(app)
        .post('/api/users')
        .set(auth(OrgRole.HIRING_MANAGER))
        .send({
          email: uniqueEmail('hm-adds'),
          fullName: 'Nope',
          role: 'recruiter_admin',
        })
        .expect(403);
    });
  });

  // ── Admin ────────────────────────────────────────────────────────────────

  describe('an admin runs the workspace', () => {
    it('can edit the question bank', async () => {
      await http(app)
        .patch(`/api/questions/${questionId}`)
        .set(auth(OrgRole.ADMIN))
        .send({ questionText: 'Rewritten by an admin' })
        .expect(200);
    });

    it('can add a colleague', async () => {
      await http(app)
        .post('/api/users')
        .set(auth(OrgRole.ADMIN))
        .send({
          email: uniqueEmail('admin-adds'),
          fullName: 'Added By Admin',
          role: 'recruiter_admin',
        })
        .expect(201);
    });

    it('cannot make somebody an owner', async () => {
      // Otherwise any admin could promote themselves and ownership would mean
      // nothing.
      await http(app)
        .patch(`/api/users/${userId[OrgRole.VIEWER]}/org-role`)
        .set(auth(OrgRole.ADMIN))
        .send({ orgRole: OrgRole.OWNER })
        .expect(403);
    });

    it('cannot demote the owner', async () => {
      await http(app)
        .patch(`/api/users/${userId[OrgRole.OWNER]}/org-role`)
        .set(auth(OrgRole.ADMIN))
        .send({ orgRole: OrgRole.VIEWER })
        .expect(403);
    });
  });

  // ── Owner ────────────────────────────────────────────────────────────────

  describe('an owner', () => {
    it('can promote somebody to owner', async () => {
      await http(app)
        .patch(`/api/users/${userId[OrgRole.ADMIN]}/org-role`)
        .set(auth(OrgRole.OWNER))
        .send({ orgRole: OrgRole.OWNER })
        .expect(200);
    });

    it('cannot demote the last owner', async () => {
      // Undo the promotion above so only one owner remains, then try.
      await http(app)
        .patch(`/api/users/${userId[OrgRole.ADMIN]}/org-role`)
        .set(auth(OrgRole.OWNER))
        .send({ orgRole: OrgRole.ADMIN })
        .expect(200);

      // A workspace with no owner cannot be handed over and has no way back.
      await http(app)
        .patch(`/api/users/${userId[OrgRole.OWNER]}/org-role`)
        .set(auth(OrgRole.OWNER))
        .send({ orgRole: OrgRole.ADMIN })
        .expect(409);
    });
  });

  // ── Cross-tenant ─────────────────────────────────────────────────────────

  it('will not change a role in another organisation', async () => {
    const stranger = await http(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail('role-stranger'),
        password: PASSWORD,
        fullName: 'Stranger Owner',
        accountType: 'recruiter',
        organisationName: `${E2E_ORG_PREFIX}roles-other ${Date.now()}`,
      })
      .expect(201);

    // 404, not 403 — a member of another workspace must be indistinguishable
    // from one that does not exist.
    await http(app)
      .patch(`/api/users/${userId[OrgRole.VIEWER]}/org-role`)
      .set({
        Authorization: `Bearer ${(stranger.body as { accessToken: string }).accessToken}`,
      })
      .send({ orgRole: OrgRole.ADMIN })
      .expect(404);
  });

  it('gives a newly provisioned colleague the least useful role, not the creator’s', async () => {
    const created = await http(app)
      .post('/api/users')
      .set(auth(OrgRole.OWNER))
      .send({
        email: uniqueEmail('role-default'),
        fullName: 'Default Role',
        role: 'recruiter_admin',
      })
      .expect(201);

    const id = (created.body as { user: { id: string } }).user.id;
    const rows = await ds.query<{ orgRole: string }[]>(
      `SELECT "orgRole" FROM users WHERE id = $1`,
      [id],
    );

    // Handing out the creator's own level by omission is how a workspace ends
    // up with five owners.
    expect(rows[0].orgRole).toBe(OrgRole.HIRING_MANAGER);
  });

  /*
   * The role has to survive the round trip to the client, not just the guard.
   *
   * The guard reads from the database on every request, so enforcement was
   * always correct — but the UI reads `orgRole` off the auth payload to decide
   * which controls to offer, and both auth queries select an explicit column
   * list that `orgRole` was never added to. The result was an owner who could
   * do everything through the API and was shown read-only screens: no test
   * caught it, because every other case here registers or provisions an
   * account (which returns the whole entity) rather than signing in.
   */
  describe('the role reaches the client', () => {
    it('is returned by login, not just enforced by the guard', async () => {
      const email = uniqueEmail('role-login');
      const registered = await http(app)
        .post('/api/auth/register')
        .send({
          email,
          password: PASSWORD,
          fullName: 'Login Owner',
          accountType: 'recruiter',
          organisationName: `${E2E_ORG_PREFIX}role-login ${Date.now()}`,
        })
        .expect(201);

      // Registration returns the saved entity, so it has always carried the
      // role — asserted here so the two paths are compared, not assumed equal.
      expect(
        (registered.body as { user: { orgRole: string } }).user.orgRole,
      ).toBe(OrgRole.OWNER);

      const signedIn = await http(app)
        .post('/api/auth/login')
        .send({ email, password: PASSWORD, portal: 'recruiter' })
        .expect(200);

      expect(
        (signedIn.body as { user: { orgRole: string } }).user.orgRole,
      ).toBe(OrgRole.OWNER);
    });

    it('survives a token refresh', async () => {
      const email = uniqueEmail('role-refresh');
      await http(app)
        .post('/api/auth/register')
        .send({
          email,
          password: PASSWORD,
          fullName: 'Refresh Owner',
          accountType: 'recruiter',
          organisationName: `${E2E_ORG_PREFIX}role-refresh ${Date.now()}`,
        })
        .expect(201);

      const signedIn = await http(app)
        .post('/api/auth/login')
        .send({ email, password: PASSWORD, portal: 'recruiter' })
        .expect(200);

      // The refresh path builds its own AuthResult from its own select list, so
      // it can drop the field independently. Without this, a session restored
      // on page load would silently lose the role the login had just carried.
      const cookie = signedIn.headers['set-cookie'] as unknown as string[];
      const refreshed = await http(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookie)
        .expect(200);

      expect(
        (refreshed.body as { user: { orgRole: string } }).user.orgRole,
      ).toBe(OrgRole.OWNER);
    });
  });
});
