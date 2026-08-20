import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { OrgRole, UserRole } from '../common/enums';
import { PERSON_VISIBLE_TO_ORG } from './directory-visibility';
import { User, type RecentRefreshToken } from './entities/user.entity';

/** The safe, client-facing shape of a user — never carries secret columns. */
export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  /**
   * The company this account works for; null for every candidate.
   *
   * Included because the client's `UserProfile` derives from its `AuthUser`,
   * which carries it — leaving it out of the payload made the type claim a field
   * that was always `undefined` at runtime.
   */
  organisationId: string | null;
  /** What this account may do inside that organisation; null for candidates. */
  orgRole: OrgRole | null;
  isActive: boolean;
  /**
   * True while the account is still using the password we generated and emailed
   * to it. The client gates the assessment list on this.
   */
  mustChangePassword: boolean;
  createdAt: Date;
}

/** What a deletion actually destroyed. Reported back so the UI can say so. */
export interface DeletionResult {
  /**
   * Whether the login row itself went. False only when the person is a
   * candidate another organisation has also invited — see `deletePerson`.
   */
  accountDeleted: boolean;
  /** Attempts wiped, and with them every answer, report and proctoring log. */
  sessions: number;
  /** Invitations withdrawn. */
  invitations: number;
}

export interface CreatedUser {
  user: UserProfile;
  /**
   * Returned exactly once, to the recruiter who created the account, and never
   * stored in readable form. Until invite emails exist this is the only way the
   * new account can be handed over.
   */
  temporaryPassword: string;
}

export interface UserListQuery {
  role?: UserRole;
  search?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  /** Loads a user or throws — used by the profile endpoints. */
  private async getOrThrow(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** The shape the client is allowed to see for its own account. */
  async getProfile(id: string): Promise<UserProfile> {
    return this.toProfile(await this.getOrThrow(id));
  }

  /** Rename the signed-in user. Only the display name is editable here. */
  async updateName(id: string, fullName: string): Promise<UserProfile> {
    const user = await this.getOrThrow(id);
    user.fullName = fullName.trim();
    return this.toProfile(await this.users.save(user));
  }

  /**
   * Change password while signed in. Requires the current password — this is a
   * deliberate, authenticated change, not the out-of-scope reset flow. Existing
   * sessions are left alone; the caller keeps their access token.
   */
  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findOne({
      where: { id },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Whatever we generated and emailed is now worthless, which is the whole
    // point of forcing this step.
    await this.users.update(
      { id },
      {
        passwordHash: await argon2.hash(newPassword),
        mustChangePassword: false,
      },
    );
  }

  /**
   * Changes a colleague's workspace role.
   *
   * Three rules the controller's `@MinOrgRole(ADMIN)` floor cannot express,
   * because each depends on who the target is rather than only on who is
   * asking:
   *
   *  - **Only an Owner may grant or remove Owner.** Otherwise any Admin could
   *    promote themselves and there would be no ownership to speak of.
   *  - **The last Owner cannot be demoted.** A workspace with no owner is one
   *    nobody can ever hand over or fully administer, and there is no
   *    self-service way back from it.
   *  - **Only members of this organisation.** Same 404-not-403 rule as
   *    everywhere else, so ids cannot be probed across tenants.
   */
  async setOrgRole(
    userId: string,
    orgRole: OrgRole,
    organisationId: string,
    actingUserId: string,
  ): Promise<UserProfile> {
    const target = await this.users.findOne({
      where: { id: userId, organisationId },
    });
    if (!target) throw new NotFoundException('User not found');

    const actor = await this.users.findOne({
      where: { id: actingUserId, organisationId },
    });
    const actorIsOwner = actor?.orgRole === OrgRole.OWNER;

    const touchesOwnership =
      orgRole === OrgRole.OWNER || target.orgRole === OrgRole.OWNER;

    if (touchesOwnership && !actorIsOwner) {
      throw new ForbiddenException(
        'Only an owner can grant or remove ownership.',
      );
    }

    if (target.orgRole === OrgRole.OWNER && orgRole !== OrgRole.OWNER) {
      const owners = await this.users.count({
        where: { organisationId, orgRole: OrgRole.OWNER },
      });
      if (owners <= 1) {
        throw new ConflictException(
          'This is the only owner. Make somebody else an owner first.',
        );
      }
    }

    target.orgRole = orgRole;
    return this.toProfile(await this.users.save(target));
  }

  /**
   * Sets a password without knowing the old one — the reset path.
   *
   * Separate from `changePassword` on purpose: that method proves the caller
   * already has the password, which is exactly what someone resetting cannot
   * do. Possession of a live single-use token is the proof here, and verifying
   * it is `AuthService`'s job, so this method must never be reachable from a
   * controller directly.
   *
   * Clears `mustChangePassword` for the same reason `changePassword` does: the
   * password is now one the account holder chose, so whatever was generated and
   * emailed is worthless.
   */
  async setPassword(id: string, newPassword: string): Promise<void> {
    const result = await this.users.update(
      { id },
      {
        passwordHash: await argon2.hash(newPassword),
        mustChangePassword: false,
      },
    );

    if (!result.affected) throw new NotFoundException('User not found');
  }

  /**
   * Directory listing for the recruiter's People page, scoped to one
   * organisation.
   *
   * Two different rules, because "belongs to this company" means two different
   * things:
   *
   *   - A **recruiter** is a member of the organisation, so `organisationId`
   *     answers it directly.
   *   - A **candidate** belongs to no organisation at all — the same person sits
   *     assessments for whoever invites them. So they appear here only if this
   *     organisation has actually invited them to one of its assessments.
   *
   * Without this the page listed every account on the platform: a brand-new
   * organisation that had invited nobody could read every other customer's
   * candidates by name and email, and their recruiters' accounts too.
   *
   * The candidate match allows either `candidateId` or the email, because
   * invitations are keyed on email and `candidateId` is only backfilled once the
   * person registers — matching on one alone would drop real invitees.
   */
  async list(
    query: UserListQuery,
    organisationId: string,
  ): Promise<{
    items: UserProfile[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const qb = this.users
      .createQueryBuilder('u')
      .where(PERSON_VISIBLE_TO_ORG, { organisationId });

    if (query.role) qb.andWhere('u.role = :role', { role: query.role });
    if (query.search?.trim()) {
      qb.andWhere('(u.email ILIKE :s OR u.fullName ILIKE :s)', {
        s: `%${query.search.trim()}%`,
      });
    }

    const [rows, total] = await qb
      .orderBy('u.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items: rows.map((r) => this.toProfile(r)), total, page, limit };
  }

  /**
   * Loads someone the caller's organisation is actually allowed to act on, or
   * throws.
   *
   * Uses the same rule as the listing, deliberately: an id outside this
   * organisation's directory must not be removable by guessing it. A miss is a
   * **404, not a 403** — a 403 would confirm the id exists and belongs to
   * someone else, which is exactly what makes ids worth probing.
   */
  private async findVisibleOrThrow(
    id: string,
    organisationId: string,
  ): Promise<User> {
    const person = await this.users
      .createQueryBuilder('u')
      .where('u.id = :id', { id })
      .andWhere(PERSON_VISIBLE_TO_ORG, { organisationId })
      .getOne();

    if (!person) throw new NotFoundException('Person not found');
    return person;
  }

  /**
   * Delete someone, and everything this organisation holds about them.
   *
   * Once this returns, nothing about the person is reachable from this
   * organisation: not the account, not their attempts, answers, reports or
   * proctoring logs, not the invitations that brought them in.
   *
   * The two roles reach that same end state by different routes:
   *
   *   - A **colleague** is a member of the company, so the account row goes.
   *     Their assessments and questions survive them — both `createdById`
   *     columns are `SET NULL` — because deleting a recruiter must not delete
   *     the company's work.
   *   - A **candidate** is org-less and shared: the same person sits assessments
   *     for whoever invites them. So their data is deleted **within this
   *     organisation**, and the login row goes too — unless another organisation
   *     has also invited them, in which case it has to survive for that
   *     organisation's sake. Either way this organisation sees nothing of them
   *     again, because the directory only ever shows candidates it has invited,
   *     and those invitations have just been deleted.
   *
   * Deleting yourself is refused. It is almost always a misclick, and an
   * organisation whose last recruiter deleted themselves would be left with
   * assessments, questions and candidates nobody can ever reach again — every
   * recruiter endpoint scopes through `@CurrentOrg()`.
   */
  async deletePerson(
    id: string,
    organisationId: string,
    actingUserId: string,
  ): Promise<DeletionResult> {
    const person = await this.findVisibleOrThrow(id, organisationId);

    if (person.id === actingUserId) {
      throw new BadRequestException(
        'You cannot delete your own account. Ask another recruiter in your organisation to do it.',
      );
    }

    if (person.role === UserRole.RECRUITER_ADMIN) {
      await this.users.delete({ id: person.id });
      return { accountDeleted: true, sessions: 0, invitations: 0 };
    }

    return this.dataSource.transaction(async (manager) => {
      // Sessions first. `assessment_sessions.invitationId` is RESTRICT, so
      // deleting the invitations while an attempt still points at them is
      // refused by the database — the order here is not a style choice.
      //
      // Deleting a session takes its responses, report, module results and
      // proctoring logs with it; all four cascade.
      const sessions = await manager
        .createQueryBuilder()
        .delete()
        .from('assessment_sessions')
        .where(
          `"assessmentId" IN (SELECT id FROM assessments WHERE "organisationId" = :organisationId)`,
          { organisationId },
        )
        .andWhere(`"candidateId" = :candidateId`, { candidateId: person.id })
        .execute();

      // Matched on id *or* email for the same reason the directory rule is:
      // invitations are email-keyed and `candidateId` is only backfilled at
      // registration, so matching on one alone would strand the other half.
      const invitations = await manager
        .createQueryBuilder()
        .delete()
        .from('invitations')
        .where(
          `"assessmentId" IN (SELECT id FROM assessments WHERE "organisationId" = :organisationId)`,
          { organisationId },
        )
        .andWhere(
          `("candidateId" = :candidateId OR lower(email) = lower(:email))`,
          {
            candidateId: person.id,
            email: person.email,
          },
        )
        .execute();

      // Does anyone else still hold this candidate? If not, the account has no
      // remaining purpose and goes too. If another organisation does, deleting
      // it would take their attempts and reports with it — one customer must
      // never be able to erase another's records.
      const [{ count }] = await manager.query<[{ count: string }]>(
        `SELECT count(*)::text AS count
           FROM invitations i
           JOIN assessments a ON a.id = i."assessmentId"
          WHERE i."candidateId" = $1 OR lower(i.email) = lower($2)`,
        [person.id, person.email],
      );

      const accountDeleted = Number(count) === 0;
      if (accountDeleted) {
        await manager.delete(User, { id: person.id });
      }

      // `affected` is the real row count. An earlier version counted the array
      // returned by a raw `RETURNING` query, which for TypeORM is a
      // [rows, affectedCount] tuple — so it reported "2" for everything.
      return {
        accountDeleted,
        sessions: sessions.affected ?? 0,
        invitations: invitations.affected ?? 0,
      };
    });
  }

  /**
   * Recruiter-provisioned account. The password is generated here rather than
   * chosen by the creating recruiter: it keeps a weak shared password from
   * becoming the norm across every account one recruiter creates, and it means
   * no one types someone else's credentials into a form.
   *
   * The new user should change it from their profile page after first sign-in.
   */
  async createByAdmin(data: {
    email: string;
    fullName: string;
    role: UserRole;
    /** The creating recruiter's organisation — see below. */
    organisationId: string;
    /**
     * What the new colleague may do. Defaults to the least privilege that is
     * still useful rather than to the creator's own level: handing out Admin
     * by omission is how a workspace ends up with five owners.
     */
    orgRole?: OrgRole;
  }): Promise<CreatedUser> {
    const email = data.email.trim().toLowerCase();
    if (await this.findByEmail(email)) {
      throw new ConflictException('An account with that email already exists');
    }

    // 12 random bytes → 16 base64url characters, comfortably past the 8-char
    // floor the change-password endpoint enforces.
    const temporaryPassword = randomBytes(12).toString('base64url');

    const user = await this.create({
      email,
      fullName: data.fullName.trim(),
      role: data.role,
      passwordHash: await argon2.hash(temporaryPassword),
      // A colleague joins the organisation of whoever created them; a candidate
      // belongs to none. Without this a provisioned recruiter had no
      // organisation, so `@CurrentOrg()` refused them on every endpoint and
      // they could sign in and do precisely nothing.
      organisationId:
        data.role === UserRole.RECRUITER_ADMIN ? data.organisationId : null,
      // Ownership is never granted by provisioning — it is transferred by the
      // owner, deliberately. A recruiter created here starts as a Hiring
      // Manager unless the creator says otherwise.
      orgRole:
        data.role === UserRole.RECRUITER_ADMIN
          ? (data.orgRole ?? OrgRole.HIRING_MANAGER)
          : null,
    });

    return { user: this.toProfile(user), temporaryPassword };
  }

  /**
   * Creates a candidate account for an invited email and returns the password to
   * send them — or `null` when that email already has an account.
   *
   * The null case is the important one. A candidate account is org-less and
   * shared: the same person sits assessments for whoever invites them. If
   * inviting an existing address minted a fresh password, any recruiter could
   * invite `someone@example.com`, receive working credentials for an account
   * that is already taking another company's assessments, and read those
   * results. So an existing account is left completely untouched — no new
   * password, no flag, nothing — and the caller sends them a different email
   * telling them to sign in as they already do.
   *
   * The generated password is returned once and never stored in readable form.
   */
  async provisionCandidateForInvite(
    email: string,
    fullName: string,
  ): Promise<{ userId: string; temporaryPassword: string } | null> {
    const normalised = email.trim().toLowerCase();
    if (await this.findByEmail(normalised)) return null;

    // 12 random bytes → 16 base64url characters, comfortably past the 8-char
    // floor the change-password endpoint enforces.
    const temporaryPassword = randomBytes(12).toString('base64url');

    const user = await this.create({
      email: normalised,
      fullName: fullName.trim() || normalised,
      role: UserRole.CANDIDATE,
      passwordHash: await argon2.hash(temporaryPassword),
      // A candidate belongs to no organisation, permanently — they sit
      // assessments for whoever invites them.
      organisationId: null,
      // They are signing in with a password we mailed them in plaintext, so
      // they must replace it before reaching an assessment.
      mustChangePassword: true,
    });

    return { userId: user.id, temporaryPassword };
  }

  /**
   * Deletes an account that this invite flow created and nobody ever used.
   *
   * Called when a recruiter removes an invitation they added by mistake — a
   * mistyped address otherwise leaves a live account behind with a password
   * sitting in some stranger's inbox.
   *
   * Deliberately narrow, because "withdrawing an invitation" must never become
   * a way to delete a real person's account. All four have to hold:
   *
   *   - it is a candidate;
   *   - `mustChangePassword` is still set, so they never signed in and chose
   *     their own password — the account is still ours, not theirs;
   *   - no invitation anywhere still refers to them, including other
   *     organisations', so no other company loses a candidate;
   *   - they have never started an assessment.
   *
   * Any one of those failing means the account stays and the caller simply
   * removed an invitation.
   */
  async deleteProvisionedIfUnused(email: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    if (!user) return false;
    if (user.role !== UserRole.CANDIDATE) return false;
    if (!user.mustChangePassword) return false;

    const [{ invitations, sessions }] = await this.dataSource.query<
      [{ invitations: string; sessions: string }]
    >(
      `SELECT
         (SELECT count(*) FROM invitations i
           WHERE i."candidateId" = $1 OR lower(i.email) = lower($2))::text AS invitations,
         (SELECT count(*) FROM assessment_sessions s
           WHERE s."candidateId" = $1)::text AS sessions`,
      [user.id, user.email],
    );

    if (Number(invitations) > 0 || Number(sessions) > 0) return false;

    await this.users.delete({ id: user.id });
    return true;
  }

  private toProfile(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organisationId: user.organisationId,
      // Needed by the People page to show and change what a colleague may do,
      // and by the client to hide controls it knows will be refused. The guard
      // is still the enforcement; this only stops the UI offering dead buttons.
      orgRole: user.orgRole,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    };
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email: email.toLowerCase() } });
  }

  /** Includes the `select: false` secret columns; use only in auth flows. */
  findByEmailWithSecrets(email: string): Promise<User | null> {
    return this.users.findOne({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        isActive: true,
        fullName: true,
        // All three are read by `issueTokens`. Omitting a column from `select`
        // yields undefined rather than an error, so leaving one out silently
        // ships a payload with a field missing — which is exactly what happened
        // to `orgRole`: it was added to `AuthResult` and to the entity, but not
        // here, so every login returned it as undefined while the database held
        // 'owner'. The UI reads it to decide which controls to offer, so the
        // symptom was an owner shown a read-only settings page.
        organisationId: true,
        orgRole: true,
        mustChangePassword: true,
      },
    });
  }

  findByIdWithRefreshToken(id: string): Promise<User | null> {
    return this.users.findOne({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        organisationId: true,
        // Same list as the login select, for the same reason: a refresh returns
        // a fresh `AuthResult`, so dropping it here would restore a session
        // whose orgRole is undefined and quietly hide the controls again on the
        // next page load.
        orgRole: true,
        mustChangePassword: true,
        hashedRefreshToken: true,
        recentRefreshTokens: true,
      },
    });
  }

  create(data: {
    email: string;
    passwordHash: string;
    fullName: string;
    role: UserRole;
    /**
     * The company this account works for. Null for a candidate — permanently, by
     * design: a candidate is a person rather than a customer's record, and the
     * same account sits assessments for whoever invites them.
     */
    organisationId?: string | null;
    /**
     * What this account may do inside that organisation. Null for a candidate,
     * for the same reason `organisationId` is.
     */
    orgRole?: OrgRole | null;
    /** Set only by the invite flow — see `provisionCandidateForInvite`. */
    mustChangePassword?: boolean;
  }): Promise<User> {
    const user = this.users.create({
      ...data,
      email: data.email.toLowerCase(),
    });
    return this.users.save(user);
  }

  /** Fresh sign-in: nothing earlier is worth honouring. */
  async startRefreshTokenChain(userId: string, hash: string): Promise<void> {
    await this.users.update(
      { id: userId },
      { hashedRefreshToken: hash, recentRefreshTokens: [] },
    );
  }

  /**
   * Records the outgoing token as recently-superseded and installs the new
   * one. Done on every successful refresh — including grace-window hits —
   * so that a token which was issued but never used still stays acceptable.
   * Skipping it there is what let rapid navigation strand a live session.
   */
  async rotateRefreshToken(
    userId: string,
    newHash: string,
    supersededHash: string | null,
    recent: RecentRefreshToken[],
  ): Promise<void> {
    await this.users.update(
      { id: userId },
      {
        hashedRefreshToken: newHash,
        recentRefreshTokens: supersededHash
          ? [{ hash: supersededHash, at: new Date().toISOString() }, ...recent]
          : recent,
      },
    );
  }

  /** Logout, or suspected token theft. */
  async clearRefreshTokens(userId: string): Promise<void> {
    await this.users.update(
      { id: userId },
      { hashedRefreshToken: null, recentRefreshTokens: [] },
    );
  }
}
