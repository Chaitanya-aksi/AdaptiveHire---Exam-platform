import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Queue } from 'bullmq';
import { DataSource, IsNull, Repository } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { OrgRole, UserRole } from '../common/enums';
import { InvitationsService } from '../invitations/invitations.service';
import {
  INVITE_EMAILS_QUEUE,
  type OutboundEmailJob,
} from '../queues/invite-emails/invite-emails.job';
import { User, type RecentRefreshToken } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { OrganisationsService } from '../organisations/organisations.service';
import { LoginDto, LoginPortal } from './dto/login.dto';
import { RegisterDto, RegistrationType } from './dto/register.dto';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import type { JwtPayload } from './strategies/jwt.strategy';

/**
 * How many superseded tokens stay acceptable. A handful covers a burst of
 * rapid reloads without turning the grace window into an unbounded list of
 * usable credentials.
 */
const MAX_RECENT_REFRESH_TOKENS = 5;

/**
 * How long a reset link lasts. Short, because the link is a full credential
 * sitting in an inbox — but long enough to survive a slow mail relay and
 * somebody reading their email an hour later on a different device.
 */
const RESET_TOKEN_TTL_MINUTES = 60;

/**
 * SHA-256, not Argon2: the token is 256 bits of `randomBytes`, so there is
 * nothing to brute-force, and a deterministic digest is what lets redemption be
 * a single indexed lookup instead of a scan-and-verify over every live token.
 */
function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    /** The company this account works for; null for candidates. */
    organisationId: string | null;
    /** What they may do inside it; null for candidates. */
    orgRole: OrgRole | null;
    /**
     * True while the account is still on the password we generated and emailed
     * it. The client sends such a user to set their own before anything else.
     */
    mustChangePassword: boolean;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly invitations: InvitationsService,
    private readonly organisations: OrganisationsService,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokens: Repository<PasswordResetToken>,
    @InjectQueue(INVITE_EMAILS_QUEUE)
    private readonly emailQueue: Queue<OutboundEmailJob>,
    private readonly dataSource: DataSource,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictException('An account with that email already exists');
    }

    return dto.accountType === RegistrationType.RECRUITER
      ? this.registerRecruiter(dto, email)
      : this.registerCandidate(dto, email);
  }

  /**
   * Candidate signup, unchanged: invite-only.
   *
   * An account can only be created for an email a recruiter has already invited
   * to at least one assessment, which keeps the candidate side from filling with
   * accounts that have nothing to sit.
   */
  private async registerCandidate(
    dto: RegisterDto,
    email: string,
  ): Promise<AuthResult> {
    if (!(await this.invitations.hasInvitation(email))) {
      throw new ForbiddenException(
        'This email has not been invited. Ask the recruiter who contacted you to add it.',
      );
    }

    const user = await this.users.create({
      email,
      passwordHash: await argon2.hash(dto.password),
      fullName: dto.fullName,
      role: UserRole.CANDIDATE,
    });

    // Attach the new account to every pending invitation for this email so the
    // assessments show up the moment they sign in.
    await this.invitations.linkUserToInvitations(user.id, email);

    return this.issueTokens(user);
  }

  /**
   * Recruiter signup: open to anyone hiring, and it creates their company
   * workspace.
   *
   * The organisation and its first recruiter are written in one transaction
   * because neither is usable without the other — a recruiter with no
   * organisation is refused by `@CurrentOrg()` on every endpoint, and an
   * organisation with no members is a row nobody can reach. A half-finished
   * signup has to leave nothing behind.
   *
   * That workspace is not a convenience: it is the tenancy boundary. Every
   * recruiter-facing query filters on it, which is what stops a stranger who
   * registers from reading other companies' assessments and candidates.
   */
  private async registerRecruiter(
    dto: RegisterDto,
    email: string,
  ): Promise<AuthResult> {
    // Belt and braces over the DTO's conditional validation: this is the value
    // the whole tenancy boundary is built from, so it is checked where it is
    // used rather than only where it arrived.
    const organisationName = dto.organisationName?.trim();
    if (!organisationName) {
      throw new BadRequestException(
        'A recruiter account needs a company or organisation name.',
      );
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.dataSource.transaction(async (manager) => {
      const organisation = await this.organisations.createForSignup(
        organisationName,
        manager,
      );

      return manager.save(
        manager.create(User, {
          email,
          passwordHash,
          fullName: dto.fullName,
          role: UserRole.RECRUITER_ADMIN,
          organisationId: organisation.id,
          // Whoever registers the workspace owns it. There is nobody else to
          // grant it to, and an organisation whose only member cannot manage
          // it would be unusable from the first request.
          orgRole: OrgRole.OWNER,
        }),
      );
    });

    this.logger.log(
      `Recruiter ${email} registered and created organisation ${user.organisationId}`,
    );

    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findByEmailWithSecrets(dto.email);

    // Verify against a dummy hash when the account is missing so the response
    // time doesn't reveal whether the email exists.
    const passwordValid = user
      ? await argon2.verify(user.passwordHash, dto.password)
      : await this.burnTime(dto.password);

    if (!user || !passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }
    this.assertPortalMatchesRole(dto.portal, user.role);

    return this.issueTokens(user);
  }

  /**
   * Keeps each sign-in page to its own audience: the candidate form is for
   * candidates and the recruiter form for recruiters.
   *
   * Checked here rather than in the UI because the client cannot undo a
   * successful login — by the time it could inspect the role, an access token
   * has been issued and the httpOnly refresh cookie set, so the next page load
   * would silently restore the session and redirect to the area we just tried to
   * keep them out of. Throwing before `issueTokens` means nothing is minted.
   *
   * A 403 rather than a 401 so the client can tell "wrong door" from "wrong
   * password" and point at the right page. It only ever fires after the password
   * has already verified, so naming the account type reveals nothing to someone
   * who does not have it.
   */
  private assertPortalMatchesRole(
    portal: LoginPortal | undefined,
    role: UserRole,
  ): void {
    if (!portal) return;

    const expected =
      portal === LoginPortal.RECRUITER
        ? UserRole.RECRUITER_ADMIN
        : UserRole.CANDIDATE;
    if (role === expected) return;

    throw new ForbiddenException(
      role === UserRole.RECRUITER_ADMIN
        ? 'That is a recruiter account. Sign in on the recruiter page instead.'
        : 'That is a candidate account. Sign in on the candidate page instead.',
    );
  }

  async refresh(userId: string, presentedToken: string): Promise<AuthResult> {
    const user = await this.users.findByIdWithRefreshToken(userId);
    if (!user || !user.isActive || !user.hashedRefreshToken) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    if (await argon2.verify(user.hashedRefreshToken, presentedToken)) {
      return this.issueTokens(user, 'rotate');
    }

    // A reload that began before the last rotation's Set-Cookie landed will
    // present a superseded token. That is a race, not an attack, so honour it
    // briefly rather than destroying the session.
    if (await this.matchesRecentToken(user, presentedToken)) {
      return this.issueTokens(user, 'rotate');
    }

    // Neither current nor recently superseded: this token was never ours, or
    // it is old enough that reuse looks like theft. Revoke everything.
    await this.users.clearRefreshTokens(user.id);
    throw new UnauthorizedException('Refresh token is no longer valid');
  }

  async logout(userId: string): Promise<void> {
    await this.users.clearRefreshTokens(userId);
  }

  /**
   * Issues a reset link, if that address has an account.
   *
   * Returns nothing either way and never signals which case it was. The
   * forgot-password form is unauthenticated, so a response that differed for a
   * known address would turn it into an oracle for enumerating every email on
   * the platform — including which of a company's staff are recruiters here.
   * The throttle on the route limits how fast it can be asked at all; this
   * makes the answer worthless even when it can be.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const normalised = email.trim().toLowerCase();
    const user = await this.users.findByEmail(normalised);

    if (!user) {
      // Deliberately silent. Logged at debug only — an info-level line naming
      // the address would move the oracle from the API into the log file.
      this.logger.debug(
        `Password reset requested for an address with no account`,
      );
      return;
    }

    const resetUrl = await this.mintResetLink(user.id);

    try {
      await this.emailQueue.add(
        'password-reset',
        {
          kind: 'password-reset',
          to: user.email,
          fullName: user.fullName,
          resetUrl,
          expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          // The payload holds a live reset link, so neither outcome is retained
          // for inspection — same rule the credentials invite follows.
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      // The token is already stored, so a queue outage means the link exists
      // but never arrives. Loud, because the user is left waiting for an email
      // that is not coming and has no way to tell.
      this.logger.error(
        `Failed to queue a password-reset email: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Mints one reset token and returns the link that redeems it.
   *
   * The single place a reset link is created, so the CLI escape hatch below
   * cannot drift from the emailed one on TTL, token size or URL shape — a
   * second copy of this would be a second thing to get wrong about a live
   * credential.
   *
   * Asking again does NOT invalidate the previous link, and that is a
   * correction rather than an oversight.
   *
   * It used to. The result was a trap: the expired screen offers "send me a
   * new link", which issued a new token and killed the one the person still
   * had open in their mail client. They would go back to that tab, submit, be
   * told it had expired, ask for another — and repeat, with every attempt
   * killing the link they were about to use. Three requests in six minutes,
   * every submission refused.
   *
   * So outstanding links now coexist. Each is still single-use and still dies
   * after an hour, and the moment any one of them is redeemed the rest are
   * burned with it — see `resetPassword`, which is where invalidating a live
   * link actually protects something.
   */
  private async mintResetLink(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);

    await this.resetTokens.save(
      this.resetTokens.create({
        userId,
        tokenHash: hashResetToken(token),
        expiresAt,
      }),
    );

    const appUrl = this.config.getOrThrow<string>('appUrl');
    return `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  }

  /**
   * Mints a reset link and hands it back instead of emailing it.
   *
   * **Operator escape hatch — for the CLI only. Never expose this from a
   * controller.** It returns a live credential, and every protection the
   * emailed flow relies on comes from the fact that the link goes to the
   * account's own inbox and nowhere else. A route that returned it would let
   * anyone who could name an address take that account.
   *
   * It exists because the mail transport is the one part of this flow that is
   * not ours. When the SMTP account is rate-limited, blocked, or simply not yet
   * configured, the whole reset path is dead for a reason no code change can
   * fix — and an administrator with shell access on the server needs some way
   * to let a locked-out person back in. That administrator already has the
   * database, so this grants no access they did not have; it just saves them
   * writing the token by hand and getting the hash or the TTL wrong.
   *
   * The link is returned, never logged: printing it is the caller's decision,
   * and the caller is a terminal a human is looking at.
   */
  async issueResetLinkForOperator(
    email: string,
  ): Promise<{ resetUrl: string; expiresInMinutes: number } | null> {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    if (!user) return null;

    return {
      resetUrl: await this.mintResetLink(user.id),
      expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
    };
  }

  /**
   * Redeems a reset token and sets the new password.
   *
   * Every rejection is the same message. Distinguishing "no such token" from
   * "expired" from "already used" would tell someone holding a stolen or
   * guessed value which part they got right.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.resetTokens.findOne({
      where: { tokenHash: hashResetToken(token) },
    });

    const invalid =
      !record ||
      record.usedAt !== null ||
      record.expiresAt.getTime() < Date.now();

    if (invalid) {
      throw new BadRequestException(
        'That reset link is no longer valid. Request a new one.',
      );
    }

    // Marked spent before the password changes, and conditioned on it still
    // being unspent, so two requests arriving together cannot both succeed —
    // the second updates zero rows and is refused.
    const claimed = await this.resetTokens.update(
      { id: record.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    if (!claimed.affected) {
      throw new BadRequestException(
        'That reset link is no longer valid. Request a new one.',
      );
    }

    // Every other link this account has outstanding dies here. This is the
    // point where invalidating them is worth something: the password has just
    // changed, so any link still sitting in an inbox is a way to change it
    // again without knowing the new one.
    await this.resetTokens.update(
      { userId: record.userId, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    await this.users.setPassword(record.userId, newPassword);

    // Anyone already signed in as this account is signed out. A reset is what
    // someone does when they think another person has their password, and
    // leaving that person's session alive would defeat the point of resetting.
    await this.users.clearRefreshTokens(record.userId);

    this.logger.log(`Password reset completed for user ${record.userId}`);
  }

  private graceWindowMs(): number {
    return (this.config.get<number>('jwt.refreshGraceSeconds') ?? 0) * 1000;
  }

  /** Superseded tokens still inside the grace window, newest first. */
  private liveRecentTokens(user: User): RecentRefreshToken[] {
    const windowMs = this.graceWindowMs();
    if (windowMs <= 0) return [];

    const cutoff = Date.now() - windowMs;
    return (user.recentRefreshTokens ?? [])
      .filter((entry) => Date.parse(entry.at) >= cutoff)
      .slice(0, MAX_RECENT_REFRESH_TOKENS);
  }

  private async matchesRecentToken(
    user: User,
    presentedToken: string,
  ): Promise<boolean> {
    for (const entry of this.liveRecentTokens(user)) {
      if (await argon2.verify(entry.hash, presentedToken)) return true;
    }
    return false;
  }

  /**
   * `new-session` — sign-in; the recent list starts empty.
   * `rotate`      — any successful refresh; the outgoing token joins the
   *                 recent list so a client still holding it is not stranded.
   */
  private async issueTokens(
    user: User,
    mode: 'new-session' | 'rotate' = 'new-session',
  ): Promise<AuthResult> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('jwt.accessSecret'),
        // TTLs are validated as strings by the env schema; jsonwebtoken's
        // template-literal type can't see that, hence the cast.
        expiresIn: this.config.getOrThrow<string>('jwt.accessTtl') as never,
      }),
      // `jti` makes every refresh token unique. Without it two tokens minted
      // in the same second are byte-identical — rotation would be a no-op and
      // reuse detection could not tell generations apart.
      this.jwt.signAsync(
        { ...payload, jti: randomUUID() },
        {
          secret: this.config.getOrThrow<string>('jwt.refreshSecret'),
          expiresIn: this.config.getOrThrow<string>('jwt.refreshTtl') as never,
        },
      ),
    ]);

    const newHash = await argon2.hash(refreshToken);
    if (mode === 'rotate') {
      await this.users.rotateRefreshToken(
        user.id,
        newHash,
        user.hashedRefreshToken,
        // Trim to the newest few still inside the window; the outgoing token
        // is prepended by the service.
        this.liveRecentTokens(user).slice(0, MAX_RECENT_REFRESH_TOKENS - 1),
      );
    } else {
      await this.users.startRefreshTokenChain(user.id, newHash);
    }

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        // Returned so the frontend can tell a recruiter's workspace apart in
        // caches and query keys. It is not a capability: every request's scope
        // is read from the database, never from what the client holds.
        organisationId: user.organisationId,
        // Same caveat: this is so the UI can avoid offering buttons it knows
        // will be refused, not a permission. `OrgRolesGuard` reads the role
        // from the database on every request and is the only thing enforcing it.
        orgRole: user.orgRole,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  private async burnTime(password: string): Promise<false> {
    await argon2.hash(password);
    return false;
  }
}
