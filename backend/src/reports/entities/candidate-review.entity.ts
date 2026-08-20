import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Organisation } from '../../organisations/entities/organisation.entity';
import { AssessmentSession } from '../../sessions/entities/assessment-session.entity';
import { User } from '../../users/entities/user.entity';

/** What a recruiting team decided about one attempt. */
export enum ReviewDecision {
  SHORTLISTED = 'shortlisted',
  REJECTED = 'rejected',
}

/**
 * A recruiting team's working notes on one attempt.
 *
 * Deliberately separate from `reports`: that table is what the engine
 * *measured*, and it is regenerated from the answers whenever the report is
 * rebuilt. This is what people *decided*, and it must survive that — a
 * regenerated report should never quietly discard a shortlisting or a
 * colleague's note.
 *
 * Keyed on the session **and the organisation**, not the individual recruiter.
 * The requirement is that a note is visible to colleagues, so one shared row
 * per attempt per company is the shape that delivers it; `updatedById` records
 * who last touched it so the note is still attributable. A shared candidate sat
 * for two companies therefore gets two independent reviews, which is correct —
 * one company's rejection is none of the other's business.
 */
@Entity('candidate_reviews')
@Unique(['sessionId', 'organisationId'])
// The cohort view's read: every review for one company, joined to its sessions.
@Index(['organisationId', 'decision'])
export class CandidateReview {
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

  /** Null means seen but not decided — distinct from never looked at. */
  @Column({ type: 'enum', enum: ReviewDecision, nullable: true })
  decision!: ReviewDecision | null;

  /**
   * Free-form labels — "second round", "strong communicator", "relocating".
   *
   * A text array rather than a tag table: these are a recruiter's shorthand,
   * not reference data, and the moment they need their own table someone has
   * to curate them.
   */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags!: string[];

  /** Shared with the whole organisation. Never shown to the candidate. */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /**
   * When the rejection email went out, or null if it never has.
   *
   * The record of the send lives here rather than only in the mail queue,
   * because a queue drops its jobs and this question has to stay answerable
   * for as long as the decision does: *has this person already been told?*
   * Sending twice is worse than not sending — the second one reads as a
   * mistake by a company the candidate has already been turned down by.
   *
   * It is also why the send is a separate action from setting `decision`. The
   * cohort list writes a decision on every click as someone works down it, and
   * a mis-click that instantly emails a real candidate cannot be taken back.
   */
  @Column({ type: 'timestamptz', nullable: true })
  rejectionEmailSentAt!: Date | null;

  /**
   * Who last changed it. `SET NULL` because the decision outlives the person —
   * a recruiter leaving must not erase what their team decided.
   */
  @Column({ type: 'uuid', nullable: true })
  updatedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'updatedById' })
  updatedBy!: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
