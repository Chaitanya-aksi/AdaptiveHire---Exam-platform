import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../../common/enums';

export interface RecentRefreshToken {
  /** Argon2 hash — the plaintext token never touches the database. */
  hash: string;
  /** ISO timestamp of when this token was superseded. */
  at: string;
}
import { Invitation } from '../../invitations/entities/invitation.entity';
import { AssessmentSession } from '../../sessions/entities/assessment-session.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash!: string;

  /**
   * Hash of the currently-valid refresh token, so logout and rotation can
   * invalidate it server-side. The token itself only ever lives in an
   * httpOnly cookie.
   */
  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  hashedRefreshToken!: string | null;

  /**
   * Hashes of recently-superseded refresh tokens, newest first, each accepted
   * for a short grace window.
   *
   * A single previous slot is not enough: rapid navigation can leave the
   * browser holding a token that was issued but never used, which then matches
   * neither the current token nor the one predecessor, and the session gets
   * revoked mid-session. Keeping the last few closes that gap while reuse of a
   * genuinely unknown token still revokes immediately.
   */
  @Column({ type: 'jsonb', nullable: true, select: false })
  recentRefreshTokens!: RecentRefreshToken[] | null;

  @Column({ type: 'varchar', length: 150 })
  fullName!: string;

  @Column({ type: 'enum', enum: UserRole })
  role!: UserRole;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Invitation, (invitation) => invitation.candidate)
  invitations!: Invitation[];

  @OneToMany(() => AssessmentSession, (session) => session.candidate)
  sessions!: AssessmentSession[];
}
