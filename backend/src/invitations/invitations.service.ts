import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { IsNull, Repository } from 'typeorm';
import { InvitationStatus, UserRole } from '../common/enums';
import {
  INVITE_EMAILS_QUEUE,
  type InviteEmailJob,
} from '../queues/invite-emails/invite-emails.job';
import type { RawRow } from '../question-bank/bulk-import/spreadsheet-parser';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { UsersService } from '../users/users.service';
import { AssessmentsService } from '../assessments/assessments.service';
import { InviteRowError, mapInviteRow } from './bulk-invite/invite-row-mapper';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { Invitation } from './entities/invitation.entity';

export interface InviteFailure {
  /** 1-based spreadsheet row (counting the header), matching Excel. */
  row: number;
  email?: string;
  reason: string;
}

export interface BulkInviteResult {
  totalRows: number;
  /** New invitations created and an email queued. */
  invited: number;
  /** Rows for someone already invited to this assessment (or duplicated in the
   * same file) — a no-op, not an error. */
  skipped: number;
  failed: number;
  failures: InviteFailure[];
}

export interface AssessmentInvitationView {
  id: string;
  email: string;
  status: InvitationStatus;
  /** True once the invitee has an account (candidateId backfilled). */
  registered: boolean;
  candidateName: string | null;
  createdAt: Date;
}

export interface CandidateInvitationView {
  id: string;
  status: InvitationStatus;
  createdAt: Date;
  assessment: { id: string; title: string; description: string | null };
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @InjectRepository(Invitation)
    private readonly invitations: Repository<Invitation>,
    @InjectRepository(AssessmentSession)
    private readonly sessions: Repository<AssessmentSession>,
    private readonly users: UsersService,
    private readonly assessments: AssessmentsService,
    private readonly config: ConfigService,
    @InjectQueue(INVITE_EMAILS_QUEUE)
    private readonly inviteQueue: Queue<InviteEmailJob>,
  ) {}

  /**
   * Turns a sheet of {name, email} into pending invitations for one
   * assessment. Rows are processed independently — a bad row is reported and
   * skipped, never failing the whole upload (same contract as the question
   * bank importer).
   */
  async bulkInvite(
    assessmentId: string,
    rows: RawRow[],
    invitedById: string,
  ): Promise<BulkInviteResult> {
    // Throws 404 if the assessment doesn't exist — validated once up front.
    const assessment = await this.assessments.findOne(assessmentId);

    const failures: InviteFailure[] = [];
    const seen = new Set<string>();
    let invited = 0;
    let skipped = 0;

    for (const [index, raw] of rows.entries()) {
      const rowNumber = index + 2;

      try {
        const { fullName, email } = mapInviteRow(raw);

        // Same email twice in one file — count the first, ignore the rest.
        if (seen.has(email)) {
          skipped += 1;
          continue;
        }
        seen.add(email);

        const outcome = await this.inviteOne(
          assessmentId,
          assessment.title,
          email,
          fullName,
          invitedById,
        );
        if (outcome.created) invited += 1;
        else skipped += 1;
      } catch (error) {
        failures.push({
          row: rowNumber,
          email: raw.email?.trim(),
          reason: this.describe(error),
        });
      }
    }

    this.logger.log(
      `Bulk invite (assessment ${assessmentId}): ${invited} invited, ${skipped} skipped, ${failures.length} failed of ${rows.length} rows`,
    );

    return {
      totalRows: rows.length,
      invited,
      skipped,
      failed: failures.length,
      failures,
    };
  }

  /**
   * Invites one already-validated email. The single shared path for both the
   * spreadsheet and the add-one form, so the two can never drift on who counts
   * as invitable.
   *
   * Returns `created: false` when that email is already invited to this
   * assessment — a no-op, not an error. Throws `InviteRowError` for a real
   * rejection.
   */
  private async inviteOne(
    assessmentId: string,
    assessmentTitle: string,
    email: string,
    fullName: string,
    invitedById: string,
  ): Promise<{ created: boolean; invitation: Invitation }> {
    const existingUser = await this.users.findByEmail(email);
    if (existingUser && existingUser.role === UserRole.RECRUITER_ADMIN) {
      throw new InviteRowError(
        'that email belongs to a recruiter account, not a candidate',
      );
    }

    const already = await this.invitations.findOne({
      where: { assessmentId, email },
    });
    if (already) return { created: false, invitation: already };

    const invitation = await this.invitations.save(
      this.invitations.create({
        assessmentId,
        email,
        // Link immediately if the candidate already has an account;
        // otherwise it's backfilled when they register.
        candidateId: existingUser?.id ?? null,
        invitedById,
        status: InvitationStatus.PENDING,
      }),
    );

    await this.enqueueInvite(email, fullName, assessmentTitle);
    return { created: true, invitation };
  }

  /**
   * Invites one candidate from the form rather than a spreadsheet. Same
   * validation and the same invite email — a recruiter adding one person
   * should not have to build a file for it.
   */
  async inviteSingle(
    assessmentId: string,
    dto: CreateInvitationDto,
    invitedById: string,
  ): Promise<AssessmentInvitationView> {
    const assessment = await this.assessments.findOne(assessmentId);
    const email = dto.email.trim().toLowerCase();

    let outcome: { created: boolean; invitation: Invitation };
    try {
      outcome = await this.inviteOne(
        assessmentId,
        assessment.title,
        email,
        dto.fullName?.trim() ?? '',
        invitedById,
      );
    } catch (error) {
      if (error instanceof InviteRowError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    if (!outcome.created) {
      throw new ConflictException(
        `${email} has already been invited to this assessment.`,
      );
    }

    this.logger.log(`Invited ${email} to assessment ${assessmentId}`);
    return this.toView(
      await this.invitations.findOneOrFail({
        where: { id: outcome.invitation.id },
        relations: { candidate: true },
      }),
    );
  }

  /**
   * Removes an invitation added by mistake.
   *
   * Only possible while nothing hangs off it. Once the candidate has started,
   * `assessment_sessions` references the invitation and deleting it would take
   * their attempt with it — revoking is the honest option there, and the error
   * says so rather than failing on a foreign key.
   */
  async remove(invitationId: string): Promise<{ id: string; deleted: true }> {
    const invitation = await this.findOneOrThrow(invitationId);

    const session = await this.sessions.findOne({
      where: { invitationId },
      select: { id: true },
    });
    if (session) {
      throw new ConflictException(
        `${invitation.email} has already started this assessment, so the invitation cannot be deleted. Revoke it instead to withdraw their access.`,
      );
    }

    await this.invitations.delete(invitationId);
    this.logger.log(`Removed invitation ${invitationId} (${invitation.email})`);
    return { id: invitationId, deleted: true };
  }

  /**
   * Withdraws access without destroying the record. A revoked invitation is
   * refused by `POST /sessions/start`, and a completed attempt keeps its
   * report — the recruiter is withdrawing the invitation, not the result.
   */
  async revoke(invitationId: string): Promise<AssessmentInvitationView> {
    const invitation = await this.findOneOrThrow(invitationId);

    if (invitation.status !== InvitationStatus.REVOKED) {
      await this.invitations.update(invitationId, {
        status: InvitationStatus.REVOKED,
      });
      this.logger.log(
        `Revoked invitation ${invitationId} (${invitation.email})`,
      );
    }

    return this.toView(
      await this.invitations.findOneOrFail({
        where: { id: invitationId },
        relations: { candidate: true },
      }),
    );
  }

  private async findOneOrThrow(invitationId: string): Promise<Invitation> {
    const invitation = await this.invitations.findOne({
      where: { id: invitationId },
    });
    if (!invitation) {
      throw new NotFoundException(`Invitation ${invitationId} not found`);
    }
    return invitation;
  }

  /** Enqueue is best-effort: a queue hiccup must not undo a saved invitation. */
  private async enqueueInvite(
    email: string,
    candidateName: string,
    assessmentTitle: string,
  ): Promise<void> {
    const appUrl = this.config.getOrThrow<string>('appUrl');
    const registerUrl = `${appUrl}/register?email=${encodeURIComponent(email)}`;

    try {
      await this.inviteQueue.add(
        'invite',
        { to: email, candidateName, assessmentTitle, registerUrl },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to queue invite email for ${email}: ${
          error instanceof Error ? error.message : String(error)
        }. The invitation was still created and the email can be re-sent.`,
      );
    }
  }

  async listForAssessment(
    assessmentId: string,
  ): Promise<AssessmentInvitationView[]> {
    // Validates the assessment exists (404 otherwise).
    await this.assessments.findOne(assessmentId);

    const rows = await this.invitations.find({
      where: { assessmentId },
      relations: { candidate: true },
      order: { createdAt: 'DESC' },
    });

    return rows.map((invite) => this.toView(invite));
  }

  private toView(invite: Invitation): AssessmentInvitationView {
    return {
      id: invite.id,
      email: invite.email,
      status: invite.status,
      registered: invite.candidateId !== null,
      candidateName: invite.candidate?.fullName ?? null,
      createdAt: invite.createdAt,
    };
  }

  async listForCandidate(
    candidateId: string,
  ): Promise<CandidateInvitationView[]> {
    const rows = await this.invitations.find({
      where: { candidateId },
      relations: { assessment: true },
      order: { createdAt: 'DESC' },
    });

    return rows.map((invite) => ({
      id: invite.id,
      status: invite.status,
      createdAt: invite.createdAt,
      assessment: {
        id: invite.assessment.id,
        title: invite.assessment.title,
        description: invite.assessment.description,
      },
    }));
  }

  /** Register gate: only invited emails may create an account. */
  async hasInvitation(email: string): Promise<boolean> {
    const count = await this.invitations.count({
      where: { email: email.toLowerCase() },
    });
    return count > 0;
  }

  /**
   * Called right after a candidate registers: attach their new account to every
   * pending invitation for their email that isn't linked yet. Returns how many
   * were linked.
   */
  async linkUserToInvitations(userId: string, email: string): Promise<number> {
    const result = await this.invitations.update(
      { email: email.toLowerCase(), candidateId: IsNull() },
      { candidateId: userId },
    );
    return result.affected ?? 0;
  }

  private describe(error: unknown): string {
    if (error instanceof InviteRowError) return error.message;
    if (error instanceof Error) return error.message;
    return 'unknown error';
  }
}
