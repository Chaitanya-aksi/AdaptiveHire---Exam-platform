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
import {
  PracticeService,
  type PracticeQuestion,
} from '../question-bank/practice.service';
import { Report } from '../reports/entities/report.entity';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { Response as ResponseRow } from '../sessions/entities/response.entity';
import { SessionModuleResult } from '../sessions/entities/session-module-result.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  effectiveWindow,
  windowState,
  type InvitationWindowView,
} from '../assessments/assessment-window';
import { AssessmentsService } from '../assessments/assessments.service';
import type { Organisation } from '../organisations/entities/organisation.entity';
import type { Branding } from '../organisations/organisations.service';
import { InviteRowError, mapInviteRow } from './bulk-invite/invite-row-mapper';
import {
  buildStages,
  type AttemptSection,
  type CandidateAttempt,
  type CandidateAttemptView,
} from './candidate-attempt';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { Invitation } from './entities/invitation.entity';

/**
 * The company's branding, narrowed to what a candidate may see.
 *
 * Deliberately not the whole organisation row: a candidate has no business
 * knowing its id or slug, and passing the entity through would leak both the
 * day somebody adds a field to it.
 *
 * Null on the relation is normal rather than exceptional — an assessment's
 * organisation is only loaded on the candidate-facing queries — so this
 * degrades to AdaptiveHire's own presentation rather than throwing.
 */
function brandingOf(
  organisation: Organisation | null | undefined,
  platformSupportEmail: string | null,
): Branding {
  return {
    name: organisation?.name ?? 'AdaptiveHire',
    logoUrl: organisation?.logoUrl ?? null,
    accentColor: organisation?.accentColor ?? null,
    // Resolved here rather than in the UI: the client should be handed an
    // address or nothing, never the job of deciding which of two to prefer.
    // The company that invited them comes first — they are the only ones who
    // can act on an interrupted attempt.
    supportEmail: organisation?.supportEmail ?? platformSupportEmail ?? null,
  };
}

/**
 * Resolves one candidate's window and renders it for the wire.
 *
 * Shared by the recruiter's invite list and the candidate's own, so the two
 * cannot disagree about when somebody may sit. That disagreement is the exact
 * failure `assessment-window.ts` was written to prevent: a candidate shown a
 * Start button that the runtime then refuses, or told "opens Tuesday" by a
 * page computing the answer differently from the server that enforces it.
 */
function windowViewOf(
  invitation: { opensAt: Date | null; expiresAt: Date | null },
  assessment: { opensAt: Date | null; closesAt: Date | null },
): InvitationWindowView {
  const window = effectiveWindow(assessment, invitation);

  return {
    overrideOpensAt: invitation.opensAt?.toISOString() ?? null,
    overrideExpiresAt: invitation.expiresAt?.toISOString() ?? null,
    opensAt: window.opensAt?.toISOString() ?? null,
    closesAt: window.closesAt?.toISOString() ?? null,
    state: windowState(window),
  };
}

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
  /**
   * Null only when the assessment relation was not loaded.
   *
   * Every caller loads it, and two of them had to be corrected to — filtering
   * a query by `assessment.organisationId` does not populate the relation, so
   * `revoke` and `inviteOne` both returned null here until they asked for it
   * explicitly. Kept nullable rather than asserted so the next such caller
   * reports "unknown" instead of a window that silently says "always open".
   */
  window: InvitationWindowView | null;
}

export interface CandidateInvitationView {
  id: string;
  status: InvitationStatus;
  createdAt: Date;
  assessment: {
    id: string;
    title: string;
    description: string | null;
    /** Subject names in the order they will be sat. Never their scoring type. */
    modules: string[];
    /** Sum of the per-module limits — the longest the whole test can run. */
    totalTimeSeconds: number;
  };
  /**
   * The company asking, and how it presents itself.
   *
   * Carried per invitation rather than taken from the viewer, because a
   * candidate belongs to no organisation and may hold invitations from
   * several at once. Branding the whole portal to one of them would be wrong
   * for everyone else in the list.
   */
  organisation: Branding;
  /**
   * When they may sit it, already resolved. Drives whether the list offers a
   * Start button or explains why it cannot yet.
   */
  window: InvitationWindowView;
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @InjectRepository(Invitation)
    private readonly invitations: Repository<Invitation>,
    @InjectRepository(AssessmentSession)
    private readonly sessions: Repository<AssessmentSession>,
    // All three read-only, and only for the candidate's own attempt view.
    @InjectRepository(SessionModuleResult)
    private readonly moduleResults: Repository<SessionModuleResult>,
    @InjectRepository(ResponseRow)
    private readonly responses: Repository<ResponseRow>,
    @InjectRepository(Report)
    private readonly reports: Repository<Report>,
    private readonly users: UsersService,
    private readonly assessments: AssessmentsService,
    // Practice questions for the pre-assessment rehearsal. Read-only, and it
    // owns the "which questions may this organisation see" rule so this service
    // does not grow a second copy of it.
    private readonly practice: PracticeService,
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
    organisationId: string,
    invitedById: string,
  ): Promise<BulkInviteResult> {
    // Throws 404 if the assessment doesn't exist *or* belongs to another
    // organisation — validated once up front, so no row can invite a candidate
    // into somebody else's assessment.
    const assessment = await this.assessments.findOne(
      assessmentId,
      organisationId,
    );

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
    organisationId: string,
    invitedById: string,
  ): Promise<AssessmentInvitationView> {
    const assessment = await this.assessments.findOne(
      assessmentId,
      organisationId,
    );
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
        // The assessment as well, or `toView` has no round to resolve the
        // window against and reports null — which reads as "no schedule" for a
        // candidate who has in fact inherited the round's.
        relations: { candidate: true, assessment: true },
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
  async remove(
    invitationId: string,
    organisationId: string,
  ): Promise<{ id: string; deleted: true; accountDeleted: boolean }> {
    const invitation = await this.findOneOrThrow(invitationId, organisationId);

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

    // A mistyped address provisions an account before anyone notices the typo.
    // Removing the invitation is the moment that account becomes pointless, so
    // it goes with it — but only if it was never used; the rule lives in
    // `deleteProvisionedIfUnused` and refuses anything that is really someone's.
    const accountDeleted = await this.users.deleteProvisionedIfUnused(
      invitation.email,
    );

    this.logger.log(
      `Removed invitation ${invitationId} (${invitation.email})` +
        (accountDeleted ? ' and the unused account it created' : ''),
    );
    return { id: invitationId, deleted: true, accountDeleted };
  }

  /**
   * Withdraws access without destroying the record. A revoked invitation is
   * refused by `POST /sessions/start`, and a completed attempt keeps its
   * report — the recruiter is withdrawing the invitation, not the result.
   */
  async revoke(
    invitationId: string,
    organisationId: string,
  ): Promise<AssessmentInvitationView> {
    const invitation = await this.findOneOrThrow(invitationId, organisationId);

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

  /**
   * One invitation, and only if it belongs to the asking organisation.
   *
   * Scoped through the assessment rather than by a column on the invitation
   * itself: the owning company is a fact about the assessment, and copying it
   * onto every invitation would be a second copy that can drift out of step with
   * the first. One join is cheaper than that risk.
   */
  private async findOneOrThrow(
    invitationId: string,
    organisationId: string,
  ): Promise<Invitation> {
    const invitation = await this.invitations.findOne({
      where: { id: invitationId, assessment: { organisationId } },
      // Loaded rather than merely filtered on: callers pass the result to
      // `toView`, which needs the round's own dates to resolve the window.
      // Filtering by `assessment.organisationId` does not populate it.
      relations: { candidate: true, assessment: true },
    });
    if (!invitation) {
      throw new NotFoundException(`Invitation ${invitationId} not found`);
    }
    return invitation;
  }

  /**
   * Provisions an account for a brand-new invitee and emails them credentials;
   * an address that already has an account just gets told to sign in.
   *
   * That split is a security boundary, not a nicety. A candidate account is
   * org-less and shared — the same person tests for whoever invites them — so
   * minting a fresh password for an existing address would let any recruiter
   * invite it, receive working credentials, and read another company's results
   * for that person. `provisionCandidateForInvite` returns null in that case and
   * touches nothing.
   *
   * Enqueue stays best-effort: a queue hiccup must not undo a saved invitation.
   * Provisioning is deliberately *not* best-effort — if the account cannot be
   * created there is no point sending an email about it, so that error
   * propagates and the caller sees the invite fail.
   */
  private async enqueueInvite(
    email: string,
    candidateName: string,
    assessmentTitle: string,
  ): Promise<void> {
    const appUrl = this.config.getOrThrow<string>('appUrl');
    const loginUrl = `${appUrl}/login?email=${encodeURIComponent(email)}`;

    const provisioned = await this.users.provisionCandidateForInvite(
      email,
      candidateName,
    );

    // The invitation row was written before this account existed, so its
    // `candidateId` is still null. Backfilling it here is what the self-service
    // registration path does on sign-up — a provisioned candidate never
    // registers, so without this their invitation stays unlinked and
    // `listForCandidate` shows them an empty assessment list forever.
    if (provisioned) {
      await this.linkUserToInvitations(provisioned.userId, email);
    }

    try {
      await this.inviteQueue.add(
        'invite',
        {
          kind: provisioned ? 'credentials' : 'existing-account',
          to: email,
          candidateName,
          assessmentTitle,
          loginUrl,
          password: provisioned?.temporaryPassword,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          // A failed `credentials` job holds a plaintext password in its payload,
          // so failures are not retained for inspection the way other queues do.
          removeOnFail: true,
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
    organisationId: string,
  ): Promise<AssessmentInvitationView[]> {
    // Validates the assessment exists and belongs to this organisation (404
    // otherwise). Without this, an id from another company would list its
    // candidates' names and email addresses.
    await this.assessments.findOne(assessmentId, organisationId);

    const rows = await this.invitations.find({
      where: { assessmentId },
      // The assessment too: a window is only meaningful once the round's own
      // dates are known, since most invitations carry no override and inherit
      // them wholesale.
      relations: { candidate: true, assessment: true },
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
      window: invite.assessment
        ? windowViewOf(invite, invite.assessment)
        : null,
    };
  }

  /**
   * Moves one candidate's window.
   *
   * Sets the per-invitation override rather than the assessment's own window,
   * so rescheduling somebody who missed the round does not move it for the
   * ninety people who did not. `null` clears an override and returns that end
   * to the assessment's schedule; an omitted field is left alone.
   *
   * Deliberately allowed after the candidate has started. The window is only
   * checked on the way in, so a reschedule cannot interrupt an attempt already
   * running — it governs whether they could start, not whether they may finish.
   */
  async reschedule(
    invitationId: string,
    organisationId: string,
    changes: { opensAt?: string | null; expiresAt?: string | null },
  ): Promise<AssessmentInvitationView> {
    const invitation = await this.invitations.findOne({
      where: { id: invitationId },
      relations: { assessment: true, candidate: true },
    });

    // 404 for another organisation's invitation, as everywhere else, so ids
    // cannot be probed across tenants.
    if (
      !invitation ||
      invitation.assessment.organisationId !== organisationId
    ) {
      throw new NotFoundException('Invitation not found');
    }

    if (changes.opensAt !== undefined) {
      invitation.opensAt = changes.opensAt ? new Date(changes.opensAt) : null;
    }
    if (changes.expiresAt !== undefined) {
      invitation.expiresAt = changes.expiresAt
        ? new Date(changes.expiresAt)
        : null;
    }

    // Validated against the window that will actually apply — the override may
    // supply one end and the assessment the other, so checking the two sent
    // values against each other would miss the case that matters.
    const window = effectiveWindow(invitation.assessment, invitation);
    if (
      window.opensAt &&
      window.closesAt &&
      window.opensAt.getTime() >= window.closesAt.getTime()
    ) {
      throw new BadRequestException(
        'That window closes before it opens. Check the dates.',
      );
    }

    return this.toView(await this.invitations.save(invitation));
  }

  /**
   * One invitation in full, for the candidate it belongs to: where they are in
   * the process, and — once they have begun — how their own attempt went.
   *
   * "How it went" means participation only. See `candidate-attempt.ts` for the
   * line and why it sits there.
   */
  async attemptForCandidate(
    invitationId: string,
    candidateId: string,
  ): Promise<CandidateAttemptView> {
    // Same id-or-email match as `listForCandidate`, and the same 404-for-
    // somebody-else's-row rule the recruiter side uses: another candidate's
    // invitation must not be distinguishable from one that does not exist.
    const invite = await this.invitations
      .createQueryBuilder('i')
      .innerJoinAndSelect('i.assessment', 'assessment')
      .leftJoinAndSelect('assessment.modules', 'am')
      .leftJoinAndSelect('am.module', 'module')
      .leftJoinAndSelect('assessment.organisation', 'organisation')
      .innerJoin(User, 'u', 'u.id = :candidateId', { candidateId })
      .where('i.id = :invitationId', { invitationId })
      .andWhere(
        '(i."candidateId" = :candidateId OR lower(i.email) = lower(u.email))',
      )
      .orderBy('am.displayOrder', 'ASC')
      .getOne();

    if (!invite) throw new NotFoundException('Invitation not found');

    const configured = invite.assessment.modules ?? [];

    const session = await this.sessions.findOne({
      where: { invitationId: invite.id },
    });

    // Only a submitted attempt is ever handed on, so the review stage cannot be
    // reached without one; skipping the lookup keeps an in-progress attempt to
    // a single extra query.
    const report =
      session && session.submittedAt
        ? await this.reports.findOne({ where: { sessionId: session.id } })
        : null;

    return {
      invitation: {
        id: invite.id,
        status: invite.status,
        invitedAt: invite.createdAt.toISOString(),
      },
      organisation: brandingOf(
        invite.assessment.organisation,
        this.platformSupportEmail(),
      ),
      window: windowViewOf(invite, invite.assessment),
      assessment: {
        id: invite.assessment.id,
        title: invite.assessment.title,
        description: invite.assessment.description,
        sections: configured.map((m) => ({
          name: m.module.name,
          timeLimitSeconds: m.timeLimitSeconds,
        })),
        totalTimeSeconds: configured.reduce(
          (total, m) => total + m.timeLimitSeconds,
          0,
        ),
      },
      stages: buildStages({
        invitationStatus: invite.status,
        invitedAt: invite.createdAt,
        startedAt: session?.startedAt ?? null,
        submittedAt: session?.submittedAt ?? null,
        reviewReadyAt: report?.generatedAt ?? null,
      }),
      attempt: session ? await this.buildAttempt(session) : null,
    };
  }

  /** The participation figures for one session. Never reads a score column. */
  private async buildAttempt(
    session: AssessmentSession,
  ): Promise<CandidateAttempt> {
    const [results, responses] = await Promise.all([
      this.moduleResults.find({
        where: { sessionId: session.id },
        relations: { module: true },
      }),
      this.responses.find({
        where: { sessionId: session.id },
        relations: { module: true },
        order: { sequenceNumber: 'ASC' },
      }),
    ]);

    // A row with neither field set is a question the clock ran out on, not an
    // answer. Counting it would overstate what they got through.
    const answered = responses.filter(
      (r) => r.selectedOption !== null || r.selectedOptions !== null,
    );

    const secondsOf = (rows: ResponseRow[]) =>
      Math.round(
        rows.reduce((total, r) => total + (r.timeTakenMs ?? 0), 0) / 1000,
      );

    const timeOnQuestionsSeconds = secondsOf(answered);

    const sections: AttemptSection[] = results
      .map((result) => {
        const mine = answered.filter((r) => r.moduleId === result.moduleId);

        return {
          moduleId: result.moduleId,
          name: result.module.name,
          // The stored count is authoritative — the engine wrote it — and the
          // response rows are only used for the timings beside it.
          questionsAnswered: result.questionsAnswered,
          timeOnQuestionsSeconds: secondsOf(mine),
          startedAt: result.startedAt?.toISOString() ?? null,
          completedAt: result.completedAt?.toISOString() ?? null,
        };
      })
      // Sat order, so the page reads the way the test did. Results are written
      // as each module finishes, so an unfinished one has no startedAt to sort
      // on and belongs last.
      .sort((a, b) => (a.startedAt ?? '~').localeCompare(b.startedAt ?? '~'));

    return {
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      submittedAt: session.submittedAt?.toISOString() ?? null,
      questionsAnswered: answered.length,
      timeOnQuestionsSeconds,
      // Null rather than 0: an attempt with nothing answered has no pace, and
      // "0s per question" would read as impossibly fast rather than as absent.
      averageSecondsPerQuestion: answered.length
        ? Math.round(timeOnQuestionsSeconds / answered.length)
        : null,
      sections,
      pace: responses.map((r) => ({
        sequenceNumber: r.sequenceNumber,
        moduleName: r.module.name,
        seconds:
          r.timeTakenMs === null ? null : Math.round(r.timeTakenMs / 1000),
        answered: r.selectedOption !== null || r.selectedOptions !== null,
      })),
    };
  }

  async listForCandidate(
    candidateId: string,
  ): Promise<CandidateInvitationView[]> {
    // Matched on the id *or* the email, for the same reason the People
    // directory is: invitations are email-keyed and `candidateId` is a backfill,
    // so keying on it alone turns any missed backfill into a candidate who can
    // see no assessments and has no way to tell why.
    // The module names and clock come along because the candidate's list is the
    // only place they see what they are about to sit before they commit to
    // starting it. Nothing here describes how anything is scored.
    const rows = await this.invitations
      .createQueryBuilder('i')
      .innerJoinAndSelect('i.assessment', 'assessment')
      .leftJoinAndSelect('assessment.modules', 'am')
      .leftJoinAndSelect('am.module', 'module')
      .leftJoinAndSelect('assessment.organisation', 'organisation')
      .innerJoin(User, 'u', 'u.id = :candidateId', { candidateId })
      .where(
        '(i."candidateId" = :candidateId OR lower(i.email) = lower(u.email))',
      )
      .orderBy('i.createdAt', 'DESC')
      .addOrderBy('am.displayOrder', 'ASC')
      .getMany();

    return rows.map((invite) => {
      const modules = invite.assessment.modules ?? [];

      return {
        id: invite.id,
        status: invite.status,
        createdAt: invite.createdAt,
        assessment: {
          id: invite.assessment.id,
          title: invite.assessment.title,
          description: invite.assessment.description,
          modules: modules.map((m) => m.module.name),
          // The sum of the per-module limits: an upper bound, since a module
          // that stops early gives its remaining time back.
          totalTimeSeconds: modules.reduce(
            (total, m) => total + m.timeLimitSeconds,
            0,
          ),
        },
        organisation: brandingOf(
          invite.assessment.organisation,
          this.platformSupportEmail(),
        ),
        // Sent so the list can say "opens Tuesday 9am" instead of offering a
        // Start button the runtime will refuse. Computed server-side, from the
        // same helper the runtime uses, because a browser clock is not a thing
        // to gate an assessment on.
        window: windowViewOf(invite, invite.assessment),
      };
    });
  }

  /**
   * Practice questions for one of the candidate's own invitations.
   *
   * Reached through an invitation they hold, like the attempt view, so the
   * ownership check is the same one — a candidate must not be able to browse
   * another company's practice set by assessment id.
   *
   * Returns an empty array when the organisation has authored no samples for
   * these subjects. The caller skips the step rather than blocking on it:
   * practice is a courtesy, and an empty bank must never stop somebody sitting
   * an assessment they were invited to.
   */
  async practiceForCandidate(
    invitationId: string,
    candidateId: string,
  ): Promise<PracticeQuestion[]> {
    const invite = await this.invitations
      .createQueryBuilder('i')
      .innerJoinAndSelect('i.assessment', 'assessment')
      .leftJoinAndSelect('assessment.modules', 'am')
      .innerJoin(User, 'u', 'u.id = :candidateId', { candidateId })
      .where('i.id = :invitationId', { invitationId })
      // Id or email, for the same reason the list is: invitations are
      // email-keyed and `candidateId` is a backfill.
      .andWhere(
        '(i."candidateId" = :candidateId OR lower(i.email) = lower(u.email))',
      )
      .getOne();

    if (!invite) throw new NotFoundException('Invitation not found');

    return this.practice.forModules(
      (invite.assessment.modules ?? []).map((m) => m.moduleId),
      // The assessment's owner, not the candidate's — a candidate belongs to no
      // organisation, and the practice set is the inviting company's.
      invite.assessment.organisationId,
    );
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

  /**
   * The platform-wide support address, or null when none is configured.
   *
   * `get` rather than `getOrThrow`: an unset address is a supported state, not
   * a misconfiguration — see `brandingOf`, which then falls through to showing
   * the candidate no contact route at all.
   */
  private platformSupportEmail(): string | null {
    return this.config.get<string | null>('supportEmail') ?? null;
  }

  private describe(error: unknown): string {
    if (error instanceof InviteRowError) return error.message;
    if (error instanceof Error) return error.message;
    return 'unknown error';
  }
}
