import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { UserRole } from '../common/enums';
import { User, type RecentRefreshToken } from './entities/user.entity';

/** The safe, client-facing shape of a user — never carries secret columns. */
export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
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

    await this.users.update(
      { id },
      { passwordHash: await argon2.hash(newPassword) },
    );
  }

  /** Directory listing for the recruiter's People page. */
  async list(query: UserListQuery): Promise<{
    items: UserProfile[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const qb = this.users.createQueryBuilder('u');
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
    });

    return { user: this.toProfile(user), temporaryPassword };
  }

  private toProfile(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
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
