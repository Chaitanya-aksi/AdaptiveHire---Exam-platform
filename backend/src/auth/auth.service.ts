import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { UserRole } from '../common/enums';
import { InvitationsService } from '../invitations/invitations.service';
import { User, type RecentRefreshToken } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { JwtPayload } from './strategies/jwt.strategy';

/**
 * How many superseded tokens stay acceptable. A handful covers a burst of
 * rapid reloads without turning the grace window into an unbounded list of
 * usable credentials.
 */
const MAX_RECENT_REFRESH_TOKENS = 5;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: { id: string; email: string; fullName: string; role: UserRole };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly invitations: InvitationsService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictException('An account with that email already exists');
    }

    // Registration is invite-only: an account can only be created for an email
    // a recruiter has already invited to at least one assessment.
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

    return this.issueTokens(user);
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
      },
    };
  }

  private async burnTime(password: string): Promise<false> {
    await argon2.hash(password);
    return false;
  }
}
