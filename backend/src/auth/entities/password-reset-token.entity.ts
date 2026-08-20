import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * One outstanding password-reset request.
 *
 * The raw token is never stored — only its SHA-256 digest, so a leaked database
 * dump cannot be used to reset anybody's password. SHA-256 rather than Argon2
 * on purpose: this is a 256-bit random value, not a human-chosen password, so
 * there is nothing to brute-force and the digest can be looked up directly
 * instead of scanning every row and verifying each one.
 *
 * Rows are kept after use rather than deleted, so a token presented twice is
 * refused as *used* rather than silently treated as never having existed.
 */
@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  /**
   * Deleting the account takes its outstanding reset requests with it —
   * otherwise a token could outlive the user it was issued for.
   */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  /** Hex SHA-256 of the token that was emailed. Unique, so lookup is by index. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  /** Set the moment it is redeemed; a non-null value makes it unusable. */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
