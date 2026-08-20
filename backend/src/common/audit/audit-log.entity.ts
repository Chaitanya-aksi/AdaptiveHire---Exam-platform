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
 * One state-changing action, and who took it.
 *
 * Written for the questions a security review actually asks: who withdrew that
 * invitation, who deleted that assessment, who opened that candidate's report.
 * Nothing in the product recorded any of it before — the People directory
 * performs real cascading deletion and left no trace at all.
 *
 * Deliberately thin. It records *that* something happened, by whom, to which
 * id — never the payload that did it. A request body here would mean the audit
 * trail quietly became a second, less-guarded copy of the candidate data it
 * exists to protect.
 */
@Entity('audit_log')
// The two ways it gets read: "what did this person do" and "what happened to
// this thing".
@Index(['actorId', 'occurredAt'])
@Index(['resourceType', 'resourceId'])
export class AuditLogEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Null for an unauthenticated action, and null once the account is deleted —
   * `ON DELETE SET NULL`, because the record of what happened has to outlive
   * the actor. A trail that vanished when someone deleted their account would
   * be worse than no trail at all.
   */
  @Column({ type: 'uuid', nullable: true })
  actorId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actorId' })
  actor!: User | null;

  /** The acting organisation, so a trail can be scoped to one customer. */
  @Column({ type: 'uuid', nullable: true })
  organisationId!: string | null;

  /** Method and route pattern, e.g. `PATCH /invitations/:id/revoke`. */
  @Column({ type: 'varchar', length: 160 })
  action!: string;

  /** The collection acted on, e.g. `invitations`. */
  @Column({ type: 'varchar', length: 60 })
  resourceType!: string;

  /** The specific row, when the route names one. */
  @Column({ type: 'uuid', nullable: true })
  resourceId!: string | null;

  /**
   * Identifiers and outcome only — status code, the route's other id params.
   * Never a request body.
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  @Index()
  occurredAt!: Date;
}
