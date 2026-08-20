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
import ExcelJS from 'exceljs';
import { In, Repository } from 'typeorm';
import {
  INVITE_EMAILS_QUEUE,
  type OutboundEmailJob,
} from '../queues/invite-emails/invite-emails.job';
import { User } from '../users/entities/user.entity';
import { EvaluationService } from '../adaptive-engine/evaluation/evaluation.service';
import { AssessmentModule } from '../assessments/entities/assessment-module.entity';
import { Assessment } from '../assessments/entities/assessment.entity';
import {
  BehavioralPattern,
  HiringRecommendation,
  OrgRole,
  ProctoringEventType,
  ScoringType,
  SessionStatus,
} from '../common/enums';
import { Organisation } from '../organisations/entities/organisation.entity';
import { ProctoringLog } from '../proctoring/entities/proctoring-log.entity';
import type { PersonalityOption } from '../question-bank/entities/personality-question-details.entity';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { Response as ResponseRow } from '../sessions/entities/response.entity';
import { SessionModuleResult } from '../sessions/entities/session-module-result.entity';
import {
  buildBehavioralProfiles,
  type ProfileScore,
} from './behavioral-profiles';
import { CandidateMessage } from './entities/candidate-message.entity';
import {
  CandidateReview,
  ReviewDecision,
} from './entities/candidate-review.entity';
import { Report } from './entities/report.entity';
import {
  attemptTiming,
  formatDuration,
  type AttemptTiming,
} from './attempt-timing';
import {
  buildReport,
  normaliseAbility,
  type ModuleSummary,
  type ProbeSummary,
  type ReportedTrait,
  type ViolationCount,
} from './report-builder';
import { buildReportPdf, reportFileName } from './report-pdf';

export interface ReportSummaryView {
  sessionId: string;
  status: SessionStatus;
  startedAt: string;
  submittedAt: string | null;
  /** Both clocks, and whether the deadline ended it. See `attempt-timing.ts`. */
  timing: AttemptTiming;
  assessment: { id: string; title: string };
  candidate: { id: string; fullName: string; email: string };
  report: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    /** Null when the attempt produced no score to band. */
    hiringRecommendation: HiringRecommendation | null;
    /** The blended headline figure the recommendation was banded on. */
    overallScore: number | null;
    /** Its ability half, or null when the assessment had no scored section. */
    abilityScore: number | null;
    /** Its behavioural half, or null when no composite had enough evidence. */
    behavioralScore: number | null;
    generatedAt: string | null;
  };
  modules: ModuleSummary[];
  /**
   * The role-relevant composites behind `behavioralScore`.
   *
   * Recomputed on read rather than stored, exactly like `modules`: they are a
   * pure function of the trait scores, so re-deriving them means a relabelled
   * trait or a corrected weight shows up immediately instead of leaving a stale
   * copy in the reports table.
   */
  profiles: ProfileScore[];
  violations: ViolationCount[];
}

/** What one answer contributed to one trait — the evidence behind a score. */
export interface TraitContribution {
  key: string;
  label: string;
  /** On the -3..+3 authoring scale, position-weighted for a ranking. */
  weight: number;
}

/** One placed option in a ranking answer, in the order the candidate chose. */
export interface RankedChoice {
  key: string;
  text: string;
  behavior: string | null;
}

export interface AnswerDetail {
  sequenceNumber: number;
  moduleName: string;
  questionText: string;
  /** Null when the module's clock ran out with this question on screen. */
  selectedOption: string | null;
  selectedOptionText: string | null;
  /** Objective modules only. */
  correctOption: string | null;
  isCorrect: boolean | null;
  difficultyAtServe: number | null;
  abilityAfter: number | null;
  timeTakenMs: number | null;
  answeredAt: string;

  /** Behavioural questions only; null for objective and legacy Likert items. */
  pattern: BehavioralPattern | null;
  /** The categorical label on the option they chose, where one was authored. */
  behavior: string | null;
  /** Ranking answers only: the full ordering, strongest preference first. */
  ranking: RankedChoice[] | null;
  /**
   * Set on both halves of a repeat probe, so the two rows can be read as one
   * measurement. Null on every other answer.
   */
  probe: ProbeAnswerLink | null;
  /**
   * Exactly what this answer moved, and by how much.
   *
   * This is the point of the evidence view: a recruiter should be able to see
   * that a Teamwork score came from these specific choices, and disagree with
   * the engine if they read the answers differently.
   */
  traitContributions: TraitContribution[];
}

/**
 * Marks an answer as one half of a repeat probe and points at the other half.
 *
 * Carried on the answer rather than looked up by the UI because the pairing is
 * a fact about the run — which question came back reworded, and how far apart —
 * and the detail view should not have to reconstruct it from sequence numbers.
 */
export interface ProbeAnswerLink {
  /** Whether this row is the original or the reworded twin. */
  role: 'first' | 'twin';
  /** Sequence number of the other half, or null if the twin never came round. */
  partnerSequence: number | null;
  /** How far apart the two were asked, in answered questions. */
  gap: number | null;
  agreement: number | null;
  flipped: boolean | null;
}

export interface ProctoringEventDetail {
  eventType: ProctoringEventType;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
}

export interface ReportDetailView {
  sessionId: string;
  answers: AnswerDetail[];
  events: ProctoringEventDetail[];
}

/** The recruiting team's working state on one attempt. */
export interface AttemptReview {
  decision: ReviewDecision | null;
  tags: string[];
  note: string | null;
  /** Who last changed it; null once that account is gone. */
  updatedBy: string | null;
  updatedAt: string;
  /**
   * When the candidate was told, or null if they have not been.
   *
   * Drives the button: the UI shows "Send rejection email" while this is null
   * and the date once it is set. The server refuses a second send regardless —
   * this is so the recruiter can see the state, not so the client can enforce
   * it.
   */
  rejectionEmailSentAt: string | null;
}

/**
 * One message the team sent to a candidate.
 *
 * Distinct from the review's `note`, which is internal and never leaves the
 * workspace. This is correspondence — written to be read by the candidate — and
 * the two are kept in different places so neither can become the other.
 */
export interface CandidateMessageView {
  id: string;
  body: string;
  /** The address it went to, as it was at send time. */
  sentTo: string;
  /** Null once that account is gone; the record outlives the sender. */
  sentBy: string | null;
  sentAt: string;
}

export interface AttemptListItem {
  sessionId: string;
  candidate: { id: string; fullName: string; email: string };
  status: SessionStatus;
  startedAt: string;
  submittedAt: string | null;
  /**
   * The same two timestamps, plus the elapsed time between them.
   *
   * `timeOnQuestionsSeconds` is null here — computing it needs every response
   * row for every attempt in the cohort, which is not worth loading for a list
   * column. The detail view carries it.
   */
  timing: AttemptTiming;
  questionsAnswered: number;
  overallScore: number | null;
  /** The two halves behind it, so a blended figure is never unexplained. */
  abilityScore: number | null;
  behavioralScore: number | null;
  /**
   * Where this attempt places among the scored attempts at *this* assessment —
   * 1 is the highest overall score.
   *
   * Scoped to the one assessment deliberately. Each assessment is its own
   * cohort: different modules, different length, different question pool, so a
   * position only means something against the people who sat the same test.
   * This replaced a platform-wide percentile, which ranked a candidate against
   * everyone who had ever sat the module anywhere — a number a recruiter could
   * neither reproduce nor act on.
   *
   * Null while the attempt has no `overallScore`. An unfinished or unscored
   * attempt is missing data, not last place, and it takes no position at all.
   */
  rank: number | null;
  /**
   * How many attempts carry a rank, so a position always reads as "2nd of 14"
   * rather than as a bare number with no scale behind it.
   *
   * Counts scored attempts only — the same population `rank` is drawn from, so
   * the denominator can never come out smaller than the largest rank.
   */
  cohortSize: number;
  hiringRecommendation: HiringRecommendation | null;
  violationCount: number;
  /** Null until somebody on the team has acted on this attempt. */
  review: AttemptReview | null;
}

/**
 * The two-layer report.
 *
 * Layer one is `reports`: narrative, strengths, weaknesses and a rule-based
 * recommendation, computed once when the candidate submits. Layer two is the
 * per-question and per-event detail, which is queried live from `responses`
 * and `proctoring_logs` and deliberately never copied into `reports`.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(Report)
    private readonly reports: Repository<Report>,
    @InjectRepository(AssessmentSession)
    private readonly sessions: Repository<AssessmentSession>,
    @InjectRepository(SessionModuleResult)
    private readonly moduleResults: Repository<SessionModuleResult>,
    @InjectRepository(AssessmentModule)
    private readonly assessmentModules: Repository<AssessmentModule>,
    @InjectRepository(Assessment)
    private readonly assessments: Repository<Assessment>,
    @InjectRepository(ResponseRow)
    private readonly responses: Repository<ResponseRow>,
    @InjectRepository(ProctoringLog)
    private readonly logs: Repository<ProctoringLog>,
    // Reused rather than reimplemented: the evidence view must show the same
    // weights the engine scored with, including a ranking's position factors.
    private readonly evaluation: EvaluationService,
    // What the recruiting team decided, as opposed to what the engine measured.
    @InjectRepository(CandidateReview)
    private readonly reviews: Repository<CandidateReview>,
    // For the completion notification: who owns the requisition, and where the
    // report lives.
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectQueue(INVITE_EMAILS_QUEUE)
    private readonly emailQueue: Queue<OutboundEmailJob>,
    // The rejection email is sent under the hiring company's name and replies
    // go to their address, so the send path needs the organisation itself
    // rather than just its id.
    @InjectRepository(Organisation)
    private readonly organisations: Repository<Organisation>,
    // Correspondence with candidates. Append-only — there is no update path,
    // because a sent message cannot be unsent.
    @InjectRepository(CandidateMessage)
    private readonly messages: Repository<CandidateMessage>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Computes and stores the summary layer. Idempotent — the queue may retry,
   * and a recruiter opening a report whose job failed regenerates it.
   */
  async generate(sessionId: string): Promise<Report> {
    // Unscoped on purpose: this runs from the report-generation worker after a
    // candidate submits, and a queue job has no requesting organisation to
    // filter by. It is reached by session id from our own queue, never from a
    // request, so there is no id here that a user chose.
    const session = await this.loadUnscoped(sessionId);
    const modules = await this.buildModuleSummaries(session);
    const violations = await this.countViolations(sessionId);

    const built = buildReport({
      candidateName: session.candidate.fullName,
      assessmentTitle: session.assessment.title,
      sessionStatus: session.status,
      modules,
      violations,
    });

    await this.reports.upsert(
      {
        sessionId,
        summary: built.summary,
        strengths: built.strengths,
        weaknesses: built.weaknesses,
        hiringRecommendation: built.hiringRecommendation,
        overallScore: toNumeric(built.overallScore),
        abilityScore: toNumeric(built.abilityScore),
        behavioralScore: toNumeric(built.behavioralScore),
        generatedAt: new Date(),
      },
      ['sessionId'],
    );

    this.logger.log(
      `Report generated for session ${sessionId}: ` +
        `${built.overallScore ?? 'no score'} overall ` +
        `(ability ${built.abilityScore ?? '—'}, ` +
        `behavioural ${built.behavioralScore ?? '—'}) / ` +
        built.hiringRecommendation,
    );

    // After the report exists, so the email never links to a page that is not
    // ready yet. Best-effort, and deliberately not awaited into the failure
    // path: a mail outage must not fail report generation and send the whole
    // job back round the retry loop.
    await this.notifyCompletion(session);

    return this.reports.findOneOrFail({ where: { sessionId } });
  }

  /**
   * Emails whoever owns the requisition that a candidate has finished.
   *
   * Sent to the assessment's creator — the person running that role — falling
   * back to an owner of the organisation when the creator's account has since
   * been deleted (`createdById` is `SET NULL`). Without the fallback, deleting
   * a departed colleague would silently switch off notifications for every
   * assessment they had ever set up.
   */
  private async notifyCompletion(session: AssessmentSession): Promise<void> {
    try {
      const assessment = await this.assessments.findOne({
        where: { id: session.assessmentId },
        relations: { createdBy: true },
      });
      if (!assessment) return;

      let recipient = assessment.createdBy;

      if (!recipient?.isActive) {
        recipient = await this.users.findOne({
          where: {
            organisationId: assessment.organisationId,
            orgRole: OrgRole.OWNER,
            isActive: true,
          },
        });
      }

      if (!recipient) {
        this.logger.warn(
          `No one to notify about session ${session.id} — assessment ${session.assessmentId} has no active owner`,
        );
        return;
      }

      const appUrl = this.config.getOrThrow<string>('appUrl');

      await this.emailQueue.add(
        'attempt-completed',
        {
          kind: 'attempt-completed',
          to: recipient.email,
          recruiterName: recipient.fullName,
          candidateName: session.candidate.fullName,
          assessmentTitle: assessment.title,
          reportUrl: `${appUrl}/admin/reports/${session.id}`,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
    } catch (error) {
      // Loud, but never fatal: a missing notification is an inconvenience, a
      // failed report is a candidate's attempt stuck in limbo.
      this.logger.error(
        `Could not queue a completion notification for session ${session.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Recompute on a recruiter's request.
   *
   * Separate from `generate` because that one is deliberately unscoped for the
   * queue. This checks the session belongs to the caller's organisation first —
   * without it, a recruiter could rebuild and read back any other company's
   * report, since the response carries its narrative and recommendation.
   */
  async regenerate(sessionId: string, organisationId: string): Promise<Report> {
    await this.loadSession(sessionId, organisationId);
    return this.generate(sessionId);
  }

  /** Summary layer, generating it on the spot if the queued job never ran. */
  async summary(
    sessionId: string,
    organisationId: string,
  ): Promise<ReportSummaryView> {
    const session = await this.loadSession(sessionId, organisationId);

    let report = await this.reports.findOne({ where: { sessionId } });
    if (!report) {
      this.logger.warn(
        `No report for session ${sessionId} — generating it now. The queued job likely failed.`,
      );
      report = await this.generate(sessionId);
    }

    const modules = await this.buildModuleSummaries(session);

    // Only the timings, not the answers: this is one session, so the extra
    // round trip is cheap, and it lets the headline report carry both the
    // elapsed clock and the time actually spent answering — which is what
    // prints into the PDF a recruiter circulates.
    const times = await this.responses.find({
      where: { sessionId },
      select: { id: true, timeTakenMs: true },
    });

    return {
      sessionId,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      submittedAt: session.submittedAt?.toISOString() ?? null,
      timing: attemptTiming(
        session,
        times.map((row) => row.timeTakenMs),
      ),
      assessment: {
        id: session.assessmentId,
        title: session.assessment.title,
      },
      candidate: {
        id: session.candidateId,
        fullName: session.candidate.fullName,
        email: session.candidate.email,
      },
      report: {
        summary: report.summary,
        strengths: report.strengths,
        weaknesses: report.weaknesses,
        hiringRecommendation: report.hiringRecommendation,
        overallScore: toNumber(report.overallScore),
        abilityScore: toNumber(report.abilityScore),
        behavioralScore: toNumber(report.behavioralScore),
        generatedAt: report.generatedAt?.toISOString() ?? null,
      },
      modules,
      profiles: buildBehavioralProfiles(
        modules.flatMap((module) => module.traits),
      ).profiles,
      violations: await this.countViolations(sessionId),
    };
  }

  /**
   * Both layers as one downloadable PDF.
   *
   * Built here rather than in the browser because the browser cannot: no web
   * page may skip the print dialog, so a client-side "Save as PDF" is always a
   * dialog and a destination to choose. A file the server hands back with
   * `Content-Disposition: attachment` simply lands in the downloads folder.
   *
   * Both layers, always. A summary alone invites the number being taken on
   * trust, and the whole design of this report is that the evidence travels
   * with the conclusion — including when it travels as a file to somebody who
   * will never sign in to check it.
   *
   * Scoping is inherited rather than repeated: `summary` and `detail` each run
   * the organisation check, so another company's session 404s here exactly as
   * it does everywhere else.
   */
  async exportReportPdf(
    sessionId: string,
    organisationId: string,
  ): Promise<{ filename: string; body: Buffer }> {
    const [view, detail] = await Promise.all([
      this.summary(sessionId, organisationId),
      this.detail(sessionId, organisationId),
    ]);

    return {
      filename: reportFileName(view),
      body: await buildReportPdf(view, detail),
    };
  }

  /**
   * Layer two, queried live every time. Nothing here is stored on `reports`,
   * so a question whose text was corrected shows its current wording rather
   * than a stale copy.
   */
  async detail(
    sessionId: string,
    organisationId: string,
  ): Promise<ReportDetailView> {
    await this.loadSession(sessionId, organisationId);

    const answers = await this.responses.find({
      where: { sessionId },
      relations: {
        module: true,
        question: { mcqDetails: true, personalityDetails: true },
      },
      order: { sequenceNumber: 'ASC' },
    });

    const events = await this.logs.find({
      where: { sessionId },
      order: { occurredAt: 'ASC' },
    });

    const probeLinks = await this.probeLinksFor(sessionId);

    // Trait labels come from the module each answer belongs to, so a key the
    // module has since dropped still shows a readable name. Indexed once
    // rather than rescanned per trait per answer.
    const labels = new Map<string, string>();
    for (const answer of answers) {
      for (const trait of answer.module.traits ?? []) {
        labels.set(`${answer.moduleId}:${trait.key}`, trait.label);
      }
    }
    const labelFor = (moduleId: string, key: string) =>
      labels.get(`${moduleId}:${key}`) ?? humanise(key);

    return {
      sessionId,
      answers: answers.map((answer) => {
        const personality = answer.question.personalityDetails;
        const options =
          answer.question.mcqDetails?.options ?? personality?.options ?? [];
        const chosen = options.find(
          (option) => option.key === answer.selectedOption,
        );

        const weights = this.contributionsFor(answer);

        return {
          sequenceNumber: answer.sequenceNumber,
          moduleName: answer.module.name,
          questionText: answer.question.questionText,
          selectedOption: answer.selectedOption,
          selectedOptionText: chosen?.text ?? null,
          correctOption: answer.question.mcqDetails?.correctOption ?? null,
          isCorrect: answer.isCorrect,
          difficultyAtServe: toNumber(answer.questionDifficultyAtServe),
          abilityAfter: toNumber(answer.abilityEstimateAfter),
          timeTakenMs: answer.timeTakenMs,
          answeredAt: answer.answeredAt.toISOString(),

          pattern: personality?.pattern ?? null,
          probe: probeLinks.get(answer.sequenceNumber) ?? null,
          behavior: (chosen as PersonalityOption | undefined)?.behavior ?? null,
          ranking:
            answer.selectedOptions?.map((key) => {
              const option = personality?.options.find((o) => o.key === key);
              return {
                key,
                text: option?.text ?? key,
                behavior: option?.behavior ?? null,
              };
            }) ?? null,
          traitContributions: Object.entries(weights)
            .map(([key, weight]) => ({
              key,
              label: labelFor(answer.moduleId, key),
              weight: round2(weight),
            }))
            // Strongest signal first — that is what a recruiter scans for.
            .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
        };
      }),
      events: events.map((event) => ({
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        metadata: event.metadata,
      })),
    };
  }

  /**
   * Sequence number -> probe link, for every answer that is half of a pair.
   *
   * Read from the stored module results rather than recomputed: the pairing was
   * decided during the run, and re-deriving it here from question ids would risk
   * the report claiming a pairing the engine never actually made.
   */
  private async probeLinksFor(
    sessionId: string,
  ): Promise<Map<number, ProbeAnswerLink>> {
    const results = await this.moduleResults.find({ where: { sessionId } });
    const links = new Map<number, ProbeAnswerLink>();

    for (const result of results) {
      for (const pair of result.probeResults?.pairs ?? []) {
        const gap =
          pair.secondSequence === null
            ? null
            : pair.secondSequence - pair.firstSequence;

        links.set(pair.firstSequence, {
          role: 'first',
          partnerSequence: pair.secondSequence,
          gap,
          agreement: pair.agreement,
          flipped: pair.flipped,
        });

        if (pair.secondSequence !== null) {
          links.set(pair.secondSequence, {
            role: 'twin',
            partnerSequence: pair.firstSequence,
            gap,
            agreement: pair.agreement,
            flipped: pair.flipped,
          });
        }
      }
    }

    return links;
  }

  /**
   * Re-derives what one stored answer contributed, through the same evaluation
   * the engine used when it was scored. Re-deriving rather than storing the
   * weights means a recruiter always sees the question's current wording and
   * current weights — and if an author has since changed them, the evidence
   * reflects what the question says today, not a stale copy.
   *
   * Returns nothing for objective answers, unanswered questions, and any
   * answer whose question has been edited into a shape it no longer fits.
   */
  private contributionsFor(answer: ResponseRow): Record<string, number> {
    const details = answer.question.personalityDetails;
    if (!details) return {};

    try {
      if (answer.selectedOptions?.length) {
        return this.evaluation.evaluateRanking(details, answer.selectedOptions)
          .traitWeights;
      }
      if (answer.selectedOption) {
        return this.evaluation.evaluatePersonality(
          details,
          answer.selectedOption,
        ).traitWeights;
      }
    } catch {
      // The question changed after it was answered. The stored score stands;
      // this row simply cannot show its working.
    }
    return {};
  }

  /** Every attempt at one assessment — the recruiter's way into the reports. */
  async listForAssessment(
    assessmentId: string,
    organisationId: string,
  ): Promise<AttemptListItem[]> {
    // Checked up front so another company's id gives the same 404 as a
    // non-existent one. Filtering alone would return an empty list, which leaks
    // nothing but reads as "no attempts yet" — a confusing answer to give a
    // recruiter who mistyped an id, and inconsistent with every other route.
    const owned = await this.assessments.exists({
      where: { id: assessmentId, organisationId },
    });
    if (!owned) {
      throw new NotFoundException(`Assessment ${assessmentId} not found`);
    }

    const sessions = await this.sessions.find({
      where: { assessmentId },
      relations: { candidate: true },
      order: { startedAt: 'DESC' },
    });
    if (sessions.length === 0) return [];

    const sessionIds = sessions.map((session) => session.id);
    const [reports, results, events, reviews] = await Promise.all([
      this.reports.find({ where: { sessionId: In(sessionIds) } }),
      // No `module` relation: the only thing that needed it here was the
      // percentile lookup, and these rows are now read for their counts alone.
      this.moduleResults.find({ where: { sessionId: In(sessionIds) } }),
      this.logs.find({
        where: { sessionId: In(sessionIds) },
        select: { id: true, sessionId: true },
      }),
      // Scoped to the caller's organisation, not just the session: a candidate
      // who sat for two companies has a review row for each, and one company
      // must never read the other's decision or note.
      this.reviews.find({
        where: { sessionId: In(sessionIds), organisationId },
        relations: { updatedBy: true },
      }),
    ]);

    const rows = sessions.map((session) => {
      const report = reports.find((r) => r.sessionId === session.id);
      const review = reviews.find((r) => r.sessionId === session.id);
      const mine = results.filter((result) => result.sessionId === session.id);

      return {
        sessionId: session.id,
        candidate: {
          id: session.candidateId,
          fullName: session.candidate.fullName,
          email: session.candidate.email,
        },
        status: session.status,
        startedAt: session.startedAt.toISOString(),
        submittedAt: session.submittedAt?.toISOString() ?? null,
        timing: attemptTiming(session),
        questionsAnswered: mine.reduce(
          (total, result) => total + result.questionsAnswered,
          0,
        ),
        overallScore: toNumber(report?.overallScore ?? null),
        abilityScore: toNumber(report?.abilityScore ?? null),
        behavioralScore: toNumber(report?.behavioralScore ?? null),
        hiringRecommendation: report?.hiringRecommendation ?? null,
        violationCount: events.filter((event) => event.sessionId === session.id)
          .length,
        review: review
          ? {
              decision: review.decision,
              tags: review.tags,
              note: review.note,
              updatedBy: review.updatedBy?.fullName ?? null,
              updatedAt: review.updatedAt.toISOString(),
              rejectionEmailSentAt:
                review.rejectionEmailSentAt?.toISOString() ?? null,
            }
          : null,
      };
    });

    return this.rankByScore(rows);
  }

  /**
   * Places every attempt at one assessment in order, highest overall score
   * first.
   *
   * Ranked over the whole cohort, never over whatever the table is currently
   * filtered or searched down to. A standing that renumbered itself as someone
   * typed in the search box would be describing the filter rather than the
   * candidates.
   *
   * Equal scores share a position and the next distinct score resumes where
   * they left off — 1, 2, 2, 4. "Joint 2nd" is the truth about a tie, and
   * breaking it on something the assessment never measured, like who happened
   * to submit first, would invent a difference and then present it as a result.
   *
   * Ranking on `overallScore` is what makes the column agree with the Score
   * beside it. That figure is already the blend the report settled on (ability
   * and behavioural, each dropping out when the assessment did not measure it),
   * so re-deriving an order from the raw per-module numbers here would give two
   * columns that disagree without either being wrong.
   */
  private rankByScore(
    rows: Omit<AttemptListItem, 'rank' | 'cohortSize'>[],
  ): AttemptListItem[] {
    // flatMap rather than filter: it narrows away the null without a `!`
    // assertion, which is what the comparator below needs to stay honest.
    const scored = rows
      .flatMap((row) =>
        row.overallScore === null
          ? []
          : [{ sessionId: row.sessionId, score: row.overallScore }],
      )
      .sort((a, b) => b.score - a.score);

    const ranks = new Map<string, number>();
    scored.forEach((entry, index) => {
      const previous = scored[index - 1];
      const tied = previous !== undefined && previous.score === entry.score;
      ranks.set(
        entry.sessionId,
        tied ? (ranks.get(previous.sessionId) ?? index + 1) : index + 1,
      );
    });

    return rows.map((row) => ({
      ...row,
      rank: ranks.get(row.sessionId) ?? null,
      cohortSize: scored.length,
    }));
  }

  /**
   * The cohort as a spreadsheet.
   *
   * Takes the session ids the caller is looking at, in the order they are on
   * screen, rather than re-deriving the filter and sort here. The alternative
   * is a second implementation of the cohort view's filtering that has to be
   * kept in step with the first, and a file that quietly disagrees with the
   * table it came from is worse than no export at all.
   *
   * The ids are still checked against the organisation — this is a
   * presentation instruction, not an access grant.
   */
  async exportCohort(
    assessmentId: string,
    organisationId: string,
    sessionIds: string[],
  ): Promise<Buffer> {
    const all = await this.listForAssessment(assessmentId, organisationId);
    const byId = new Map(all.map((row) => [row.sessionId, row]));

    // Unknown or foreign ids are dropped rather than raising: the client may be
    // holding a row that has since been deleted, and a failed download is a
    // worse answer than a file with one fewer line.
    const rows =
      sessionIds.length > 0
        ? sessionIds
            .map((id) => byId.get(id))
            .filter((row): row is AttemptListItem => row !== undefined)
        : all;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Attempts');

    sheet.columns = [
      { header: 'Candidate', key: 'name' },
      { header: 'Email', key: 'email' },
      { header: 'Status', key: 'status' },
      { header: 'Started', key: 'started' },
      { header: 'Submitted', key: 'submitted' },
      // Human-readable rather than a raw count of seconds: this column is read,
      // not summed, and "18m 32s" needs no conversion in the reader's head.
      { header: 'Duration', key: 'duration' },
      { header: 'Overall score', key: 'overall' },
      { header: 'Ability', key: 'ability' },
      { header: 'Behavioural', key: 'behavioural' },
      { header: 'Standing', key: 'standing' },
      { header: 'Ranked out of', key: 'cohortSize' },
      { header: 'Recommendation', key: 'recommendation' },
      { header: 'Questions answered', key: 'answered' },
      { header: 'Proctoring signals', key: 'signals' },
      { header: 'Decision', key: 'decision' },
      { header: 'Tags', key: 'tags' },
      { header: 'Note', key: 'note' },
      { header: 'Note by', key: 'noteBy' },
    ];

    for (const row of rows) {
      sheet.addRow({
        name: row.candidate.fullName,
        email: row.candidate.email,
        status: row.status,
        started: row.startedAt,
        submitted: row.submittedAt ?? '',
        // Blank while an attempt is still running, and suffixed when the
        // deadline ended it — otherwise a column of identical durations reads
        // as a coincidence rather than as everyone hitting the time limit.
        duration:
          row.timing.elapsedSeconds === null
            ? ''
            : formatDuration(row.timing.elapsedSeconds) +
              (row.timing.autoSubmitted ? ' (timed out)' : ''),
        // Blank, not zero: an unscored attempt has no score, and a spreadsheet
        // full of zeroes would sort and average as though it did.
        overall: row.overallScore ?? '',
        ability: row.abilityScore ?? '',
        behavioural: row.behavioralScore ?? '',
        standing: row.rank ?? '',
        cohortSize: row.cohortSize,
        recommendation: row.hiringRecommendation ?? '',
        answered: row.questionsAnswered,
        signals: row.violationCount,
        decision: row.review?.decision ?? '',
        tags: (row.review?.tags ?? []).join(', '),
        note: row.review?.note ?? '',
        noteBy: row.review?.updatedBy ?? '',
      });
    }

    // `csv.writeBuffer` handles quoting and embedded newlines, which matters
    // here: a recruiter's note is free text and will eventually contain both.
    const buffer = await workbook.csv.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Records what the team decided about one attempt.
   *
   * An upsert on (session, organisation): the cohort view writes freely as
   * someone works through a list, and a second click must update the row rather
   * than collide with it.
   */
  async saveReview(
    sessionId: string,
    organisationId: string,
    actorId: string,
    input: {
      decision?: ReviewDecision | null;
      tags?: string[];
      note?: string | null;
    },
  ): Promise<AttemptReview> {
    // Same 404-not-403 rule as everywhere else: reviewing another company's
    // attempt must be indistinguishable from reviewing one that does not exist.
    await this.loadSession(sessionId, organisationId);

    const existing = await this.reviews.findOne({
      where: { sessionId, organisationId },
    });

    /*
     * A rejection the candidate has been told about is final.
     *
     * Not stubbornness about the data — it is that the decision has already
     * left the building. Once someone has read "we are not taking your
     * application further", quietly flipping them back to shortlisted inside
     * our own database does not un-tell them, and it leaves the workspace
     * showing a state the candidate has every reason to believe is false.
     *
     * Changing your mind is a real thing that happens, so it has its own path:
     * `sendCandidateMessage` writes to them directly. That is honest about
     * what re-engaging actually requires — talking to the person — instead of
     * pretending a toggle undoes an email.
     *
     * Only the decision is frozen. Notes and tags stay editable, because the
     * team's own record of why should keep growing after the decision.
     */
    if (
      existing?.rejectionEmailSentAt &&
      input.decision !== undefined &&
      input.decision !== ReviewDecision.REJECTED
    ) {
      throw new ConflictException(
        'This candidate has already been told they were not successful, so the ' +
          'decision cannot be changed. Use "Contact candidate" to write to them.',
      );
    }

    const saved = await this.reviews.save(
      this.reviews.create({
        ...(existing ?? {}),
        sessionId,
        organisationId,
        // Each field is only touched when the caller sent it, so setting a tag
        // does not silently clear a colleague's note.
        decision:
          input.decision !== undefined
            ? input.decision
            : (existing?.decision ?? null),
        tags: input.tags ?? existing?.tags ?? [],
        note: input.note !== undefined ? input.note : (existing?.note ?? null),
        updatedById: actorId,
      }),
    );

    /*
     * Rejecting someone tells them, in the same click.
     *
     * Guarded three ways, none of which costs the recruiter an extra step:
     *
     *  - Only when this call is the one setting `rejected`. A later note or tag
     *    edit sends `decision: undefined`, so it cannot re-trigger.
     *  - Only when nothing has been sent yet. Toggling the decision off and on
     *    again is a normal thing to do while working down a list, and it must
     *    not email the same person a second time.
     *  - A queue failure leaves the stamp null, so the decision is still saved
     *    and the manual send stays available to retry. Recording a decision is
     *    the caller's actual request; the email is what we do about it, and
     *    losing the first because SMTP hiccuped would be the wrong trade.
     */
    if (
      input.decision === ReviewDecision.REJECTED &&
      !existing?.rejectionEmailSentAt
    ) {
      try {
        await this.queueRejection(sessionId, organisationId, saved);
      } catch (error) {
        this.logger.error(
          `Rejection email could not be queued for session ${sessionId}: ` +
            `${error instanceof Error ? error.message : String(error)}. ` +
            'The decision was saved; the email can be sent from the results page.',
        );
      }
    }

    const withActor = await this.reviews.findOneOrFail({
      where: { id: saved.id },
      relations: { updatedBy: true },
    });

    return {
      decision: withActor.decision,
      tags: withActor.tags,
      note: withActor.note,
      updatedBy: withActor.updatedBy?.fullName ?? null,
      updatedAt: withActor.updatedAt.toISOString(),
      rejectionEmailSentAt:
        withActor.rejectionEmailSentAt?.toISOString() ?? null,
    };
  }

  /**
   * Writes to a candidate directly, in the recruiter's own words.
   *
   * The way back to somebody already rejected. That decision is deliberately
   * final — `saveReview` refuses to move it once the email has gone, because
   * flipping a flag in our database does not un-read what they were sent — so
   * reopening a conversation means actually talking to them.
   *
   * Sends first, then records. The record exists to answer "what did we say to
   * this person?", and a row written before a queue failure would answer it
   * wrongly. The opposite ordering from the rejection stamp, and for the
   * opposite reason: there, the risk being managed is sending twice; here,
   * sending twice is a recruiter's prerogative and claiming to have sent
   * something we did not is the real failure.
   */
  async sendCandidateMessage(
    sessionId: string,
    organisationId: string,
    actorId: string,
    body: string,
  ): Promise<CandidateMessageView> {
    // 404 for another company's attempt, as everywhere else.
    const session = await this.loadSession(sessionId, organisationId);
    const organisation = await this.organisations.findOneOrFail({
      where: { id: organisationId },
    });

    const trimmed = body.trim();
    if (!trimmed) {
      throw new BadRequestException('Write something before sending.');
    }

    await this.emailQueue.add(
      'candidate-message',
      {
        kind: 'candidate-message',
        to: session.candidate.email,
        candidateName: session.candidate.fullName,
        organisationName: organisation.name,
        assessmentTitle: session.assessment.title,
        body: trimmed,
        replyTo:
          organisation.supportEmail ??
          this.config.get<string | null>('supportEmail') ??
          null,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        // Kept on failure so a message that never arrived is discoverable.
        removeOnFail: false,
      },
    );

    const saved = await this.messages.save(
      this.messages.create({
        sessionId,
        organisationId,
        body: trimmed,
        // Captured now: the candidate may change their address later, and
        // "where did we write to?" has to stay answerable.
        sentTo: session.candidate.email,
        sentById: actorId,
      }),
    );

    this.logger.log(
      `Message queued to candidate on session ${sessionId} (organisation ${organisationId})`,
    );

    const withSender = await this.messages.findOneOrFail({
      where: { id: saved.id },
      relations: { sentBy: true },
    });

    return {
      id: withSender.id,
      body: withSender.body,
      sentTo: withSender.sentTo,
      sentBy: withSender.sentBy?.fullName ?? null,
      sentAt: withSender.sentAt.toISOString(),
    };
  }

  /** Everything this organisation has written to one candidate, newest first. */
  async listCandidateMessages(
    sessionId: string,
    organisationId: string,
  ): Promise<CandidateMessageView[]> {
    await this.loadSession(sessionId, organisationId);

    const rows = await this.messages.find({
      where: { sessionId, organisationId },
      relations: { sentBy: true },
      order: { sentAt: 'DESC' },
    });

    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      sentTo: row.sentTo,
      sentBy: row.sentBy?.fullName ?? null,
      sentAt: row.sentAt.toISOString(),
    }));
  }

  /**
   * Manual send, for a rejection that did not go out with the click.
   *
   * Rejecting a candidate emails them there and then — see `saveReview`. This
   * route covers the two cases that leaves: an attempt rejected before the
   * email existed at all, and one whose send failed because the queue was
   * down. It is the retry, not the normal path.
   *
   * Refuses rather than no-ops in every case below, because each one means the
   * caller believes something that is not true, and a silent success would let
   * them carry on believing it.
   */
  async sendRejectionEmail(
    sessionId: string,
    organisationId: string,
  ): Promise<{ sentAt: string; to: string }> {
    // 404 for another company's attempt, as everywhere else.
    await this.loadSession(sessionId, organisationId);

    const review = await this.reviews.findOne({
      where: { sessionId, organisationId },
    });

    if (review?.decision !== ReviewDecision.REJECTED) {
      throw new BadRequestException(
        'Mark this candidate as rejected before sending the email.',
      );
    }

    // The guard that matters. A second rejection reads as a mistake by a
    // company that has already turned them down, and there is no way to
    // un-send the first.
    if (review.rejectionEmailSentAt) {
      throw new ConflictException(
        `A rejection email was already sent on ${review.rejectionEmailSentAt.toISOString()}.`,
      );
    }

    return this.queueRejection(sessionId, organisationId, review);
  }

  /**
   * Queues the email and stamps the review, or leaves both undone.
   *
   * Shared by the click path and the manual retry so the two cannot drift on
   * what is sent or on when the stamp is written. Assumes its caller has
   * already established that this attempt belongs to the organisation and that
   * nothing has been sent yet — it is private for exactly that reason.
   */
  private async queueRejection(
    sessionId: string,
    organisationId: string,
    review: CandidateReview,
  ): Promise<{ sentAt: string; to: string }> {
    const session = await this.loadSession(sessionId, organisationId);
    const organisation = await this.organisations.findOneOrFail({
      where: { id: organisationId },
    });

    // Stamped before the job is queued, not after it sends. The failure this
    // orders against is a double send: if the stamp fails we have sent nothing
    // and the recruiter can retry, whereas stamping afterwards would leave a
    // sent email unrecorded and let the next click send it again.
    const sentAt = new Date();
    review.rejectionEmailSentAt = sentAt;
    await this.reviews.save(review);

    try {
      await this.emailQueue.add(
        'rejection',
        {
          kind: 'rejection',
          to: session.candidate.email,
          candidateName: session.candidate.fullName,
          organisationName: organisation.name,
          assessmentTitle: session.assessment.title,
          // The company's own address where they have set one, so a reply
          // reaches the people who decided rather than the platform.
          replyTo:
            organisation.supportEmail ??
            this.config.get<string | null>('supportEmail') ??
            null,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          // Kept on failure, unlike the credential emails: this payload holds
          // no secret, and a rejection that never went out is something a
          // recruiter needs to be able to discover.
          removeOnFail: false,
        },
      );
    } catch (error) {
      // Undo the stamp — the candidate has not been told, and leaving it set
      // would permanently block the retry.
      review.rejectionEmailSentAt = null;
      await this.reviews.save(review);
      throw error;
    }

    this.logger.log(
      `Rejection email queued for session ${sessionId} (organisation ${organisationId})`,
    );

    return { sentAt: sentAt.toISOString(), to: session.candidate.email };
  }

  // ── Assembly ─────────────────────────────────────────────────────────────

  /**
   * One session, and only if its assessment belongs to the asking organisation.
   *
   * This is the most sensitive read in the platform — a report carries the
   * candidate's name, email, every answer they gave and every proctoring event
   * recorded against them. Authorising it by session id alone, as this did while
   * recruiters were hand-seeded colleagues, means anyone who can guess or leak a
   * uuid can read that. The organisation filter is what makes the id useless on
   * its own.
   *
   * `organisationId` is required, not optional, for the same reason as on
   * assessments: an optional tenant filter is one somebody forgets to pass.
   */
  /** Session lookup with no tenant filter — only for queue-driven work. */
  private async loadUnscoped(sessionId: string): Promise<AssessmentSession> {
    const session = await this.sessions.findOne({
      where: { id: sessionId },
      relations: { candidate: true, assessment: true },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    return session;
  }

  private async loadSession(
    sessionId: string,
    organisationId: string,
  ): Promise<AssessmentSession> {
    const session = await this.sessions.findOne({
      where: { id: sessionId, assessment: { organisationId } },
      relations: { candidate: true, assessment: true },
    });
    // Same 404 whether the session does not exist or belongs to another
    // company, so the API cannot be used to probe for other customers' sessions.
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    return session;
  }

  /**
   * Joins the stored per-module results with the module catalogue (for trait
   * labels) and the assessment config (for the minimum the section asked for).
   */
  private async buildModuleSummaries(
    session: AssessmentSession,
  ): Promise<ModuleSummary[]> {
    const results = await this.moduleResults.find({
      where: { sessionId: session.id },
      relations: { module: true },
    });

    const configs = await this.assessmentModules.find({
      where: { assessmentId: session.assessmentId },
      order: { displayOrder: 'ASC' },
    });

    // Ordered by the assessment's own display order so the report reads in the
    // order the candidate actually sat the sections.
    const ordered = configs
      .map((config) => results.find((r) => r.moduleId === config.moduleId))
      .filter((result): result is SessionModuleResult => result !== undefined);

    return ordered.map((result) => {
      const ability = toNumber(result.abilityScore);
      const isObjective = result.module.scoringType === ScoringType.OBJECTIVE;
      const minQuestions =
        configs.find((config) => config.moduleId === result.moduleId)
          ?.minQuestions ?? 0;
      const { traits, legacyTraitModel } = this.buildTraits(result);

      return {
        moduleId: result.moduleId,
        name: result.module.name,
        slug: result.module.slug,
        scoringType: result.module.scoringType,
        abilityScore: isObjective ? ability : null,
        score:
          isObjective && ability !== null ? normaliseAbility(ability) : null,
        questionsAnswered: result.questionsAnswered,
        questionsCorrect: result.questionsCorrect,
        minQuestions,
        traits,
        consistency: this.moduleConsistency(traits),
        probes: this.buildProbes(result),
        legacyTraitModel,
      };
    });
  }

  /**
   * The repeat-probe block for one module result.
   *
   * Trait keys are resolved to labels through the module's own definitions, the
   * same way the evidence view does it, so a pair flagged on a trait the module
   * has since dropped still reads as a name rather than an engine key.
   */
  private buildProbes(result: SessionModuleResult): ProbeSummary | null {
    const stored = result.probeResults;
    if (!stored || stored.pairs.length === 0) return null;

    const labels = new Map(
      (result.module.traits ?? []).map((trait) => [trait.key, trait.label]),
    );

    return {
      agreement: stored.agreement,
      resolved: stored.resolved,
      unresolved: stored.unresolved,
      pairs: stored.pairs.map((pair) => ({
        firstSequence: pair.firstSequence,
        secondSequence: pair.secondSequence,
        agreement: pair.agreement,
        flipped: pair.flipped,
        divergentTraits: (pair.divergentTraits ?? []).map((trait) => ({
          key: trait.key,
          label: labels.get(trait.key) ?? humanise(trait.key),
          first: trait.first,
          second: trait.second,
        })),
      })),
    };
  }

  /**
   * The trait block for one module result.
   *
   * A session sat before the module's trait vocabulary changed stores keys the
   * module no longer declares. Mapping today's traits over it would find
   * nothing for every one of them and report a whole profile at a neutral 50 —
   * numbers that were never measured, presented as if they were. So when the
   * stored keys and the declared ones do not overlap at all, the stored keys
   * are reported under their own names and the result is flagged instead.
   */
  private buildTraits(result: SessionModuleResult): {
    traits: ReportedTrait[];
    legacyTraitModel: boolean;
  } {
    const scores = result.traitScores;
    if (!scores) return { traits: [], legacyTraitModel: false };

    const definitions = result.module.traits ?? [];
    const storedKeys = Object.keys(scores);
    const overlaps = definitions.some((d) => storedKeys.includes(d.key));

    if (!overlaps && storedKeys.length > 0) {
      return {
        legacyTraitModel: true,
        traits: storedKeys.map((key) => ({
          key,
          label: humanise(key),
          score: round1(scores[key].score),
          confidence: scores[key].confidence ?? 0,
          consistency: scores[key].consistency ?? null,
        })),
      };
    }

    return {
      legacyTraitModel: false,
      traits: definitions.map((definition) => {
        const measured = scores[definition.key];
        const raw = measured?.score ?? 50;

        return {
          key: definition.key,
          label: definition.label,
          // A trait whose workplace label is the opposite pole is flipped here,
          // once, so nothing downstream has to remember to do it.
          score: definition.invertForReport ? round1(100 - raw) : round1(raw),
          confidence: measured?.confidence ?? 0,
          consistency: measured?.consistency ?? null,
        };
      }),
    };
  }

  /** Mean consistency across the traits that have enough evidence to measure. */
  private moduleConsistency(traits: ReportedTrait[]): number | null {
    const measured = traits
      .map((trait) => trait.consistency)
      .filter((value): value is number => value !== null);
    if (measured.length === 0) return null;

    return round2(measured.reduce((sum, v) => sum + v, 0) / measured.length);
  }

  private async countViolations(sessionId: string): Promise<ViolationCount[]> {
    const rows = await this.logs
      .createQueryBuilder('log')
      .select('log.eventType', 'eventType')
      .addSelect('COUNT(*)', 'count')
      .where('log."sessionId" = :sessionId', { sessionId })
      .groupBy('log.eventType')
      .getRawMany<{ eventType: ProctoringEventType; count: string }>();

    return rows.map((row) => ({
      eventType: row.eventType,
      count: Number(row.count),
    }));
  }
}

/** TypeORM returns `numeric` columns as strings. */
function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** ...and expects them written back as strings. */
function toNumeric(value: number | null): string | null {
  return value === null ? null : String(value);
}

/**
 * `risk_tolerance` -> `Risk Tolerance`. Only reached for trait keys the module
 * no longer declares, where there is no authored label to use.
 */
function humanise(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
