import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organisation } from '../../organisations/entities/organisation.entity';
import { AssessmentSession } from '../../sessions/entities/assessment-session.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Something a recruiting team wrote *to* a candidate, and sent.
 *
 * Deliberately not the `note` field on `candidate_reviews`. That note is
 * internal — "shared with the whole organisation, never shown to the
 * candidate" — and the two must not become the same field, because the failure
 * mode is somebody's blunt internal assessment arriving in the candidate's
 * inbox. Different table, different intent, different audience.
 *
 * A row per message rather than one editable body, so the record is a history:
 * a team that reopens a conversation weeks later needs to see what was already
 * said, and an edited-in-place field would quietly lose it. Nothing here is
 * ever updated — a message that has been sent cannot be unsent, and a record
 * that could be rewritten afterwards would not be worth keeping.
 *
 * Scoped by organisation for the same reason reviews are: a shared candidate
 * assessed by two companies must never carry one company's correspondence into
 * the other's view.
 */
@Entity('candidate_messages')
// The read: every message for one attempt, newest first, for one company.
@Index(['sessionId', 'organisationId', 'sentAt'])
export class CandidateMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => AssessmentSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: AssessmentSession;

  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  /**
   * What was written, exactly as it was sent.
   *
   * Stored verbatim rather than as a template reference: the whole point is
   * that a person chose these words, and a record that only said "follow-up
   * template v2" would not answer the question anyone actually asks of it.
   */
  @Column({ type: 'text' })
  body!: string;

  /**
   * The address it went to, captured at send time.
   *
   * Denormalised on purpose. A candidate can change their email, and "where did
   * we actually write to?" has to stay answerable afterwards — reading it off
   * the user row later would answer a different question.
   */
  @Column({ type: 'varchar', length: 255 })
  sentTo!: string;

  /**
   * Who sent it. `SET NULL` because the record outlives the person — a
   * recruiter leaving must not erase what the company said to a candidate.
   */
  @Column({ type: 'uuid', nullable: true })
  sentById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'sentById' })
  sentBy!: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  sentAt!: Date;
}
