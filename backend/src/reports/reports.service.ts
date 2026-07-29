import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AssessmentModule } from '../assessments/entities/assessment-module.entity';
import {
  HiringRecommendation,
  ProctoringEventType,
  ScoringType,
  SessionStatus,
} from '../common/enums';
import { ProctoringLog } from '../proctoring/entities/proctoring-log.entity';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { Response as ResponseRow } from '../sessions/entities/response.entity';
import { SessionModuleResult } from '../sessions/entities/session-module-result.entity';
import { Report } from './entities/report.entity';
import {
  buildReport,
  normaliseAbility,
  type ModuleSummary,
  type ReportedTrait,
  type ViolationCount,
} from './report-builder';

export interface ReportSummaryView {
  sessionId: string;
  status: SessionStatus;
  startedAt: string;
  submittedAt: string | null;
  assessment: { id: string; title: string };
  candidate: { id: string; fullName: string; email: string };
  report: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    hiringRecommendation: HiringRecommendation;
    overallScore: number | null;
    generatedAt: string | null;
  };
  modules: ModuleSummary[];
  violations: ViolationCount[];
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

export interface AttemptListItem {
  sessionId: string;
  candidate: { id: string; fullName: string; email: string };
  status: SessionStatus;
  startedAt: string;
  submittedAt: string | null;
  questionsAnswered: number;
  overallScore: number | null;
  hiringRecommendation: HiringRecommendation | null;
  violationCount: number;
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
    @InjectRepository(ResponseRow)
    private readonly responses: Repository<ResponseRow>,
    @InjectRepository(ProctoringLog)
    private readonly logs: Repository<ProctoringLog>,
  ) {}

  /**
   * Computes and stores the summary layer. Idempotent — the queue may retry,
   * and a recruiter opening a report whose job failed regenerates it.
   */
  async generate(sessionId: string): Promise<Report> {
    const session = await this.loadSession(sessionId);
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
        overallScore:
          built.overallScore === null ? null : String(built.overallScore),
        generatedAt: new Date(),
      },
      ['sessionId'],
    );

    this.logger.log(
      `Report generated for session ${sessionId}: ` +
        `${built.overallScore ?? 'no score'} / ${built.hiringRecommendation}`,
    );

    return this.reports.findOneOrFail({ where: { sessionId } });
  }

  /** Summary layer, generating it on the spot if the queued job never ran. */
  async summary(sessionId: string): Promise<ReportSummaryView> {
    const session = await this.loadSession(sessionId);

    let report = await this.reports.findOne({ where: { sessionId } });
    if (!report) {
      this.logger.warn(
        `No report for session ${sessionId} — generating it now. The queued job likely failed.`,
      );
      report = await this.generate(sessionId);
    }

    return {
      sessionId,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      submittedAt: session.submittedAt?.toISOString() ?? null,
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
        overallScore:
          report.overallScore === null ? null : Number(report.overallScore),
        generatedAt: report.generatedAt?.toISOString() ?? null,
      },
      modules: await this.buildModuleSummaries(session),
      violations: await this.countViolations(sessionId),
    };
  }

  /**
   * Layer two, queried live every time. Nothing here is stored on `reports`,
   * so a question whose text was corrected shows its current wording rather
   * than a stale copy.
   */
  async detail(sessionId: string): Promise<ReportDetailView> {
    await this.loadSession(sessionId);

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

    return {
      sessionId,
      answers: answers.map((answer) => {
        const options =
          answer.question.mcqDetails?.options ??
          answer.question.personalityDetails?.options ??
          [];
        const chosen = options.find(
          (option) => option.key === answer.selectedOption,
        );

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
        };
      }),
      events: events.map((event) => ({
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
        metadata: event.metadata,
      })),
    };
  }

  /** Every attempt at one assessment — the recruiter's way into the reports. */
  async listForAssessment(assessmentId: string): Promise<AttemptListItem[]> {
    const sessions = await this.sessions.find({
      where: { assessmentId },
      relations: { candidate: true },
      order: { startedAt: 'DESC' },
    });
    if (sessions.length === 0) return [];

    const sessionIds = sessions.map((session) => session.id);
    const [reports, results, events] = await Promise.all([
      this.reports.find({ where: { sessionId: In(sessionIds) } }),
      this.moduleResults.find({ where: { sessionId: In(sessionIds) } }),
      this.logs.find({
        where: { sessionId: In(sessionIds) },
        select: { id: true, sessionId: true },
      }),
    ]);

    return sessions.map((session) => {
      const report = reports.find((r) => r.sessionId === session.id);

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
        questionsAnswered: results
          .filter((result) => result.sessionId === session.id)
          .reduce((total, result) => total + result.questionsAnswered, 0),
        overallScore:
          report?.overallScore == null ? null : Number(report.overallScore),
        hiringRecommendation: report?.hiringRecommendation ?? null,
        violationCount: events.filter((event) => event.sessionId === session.id)
          .length,
      };
    });
  }

  // ── Assembly ─────────────────────────────────────────────────────────────

  private async loadSession(sessionId: string): Promise<AssessmentSession> {
    const session = await this.sessions.findOne({
      where: { id: sessionId },
      relations: { candidate: true, assessment: true },
    });
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
        traits: this.buildTraits(result),
      };
    });
  }

  private buildTraits(result: SessionModuleResult): ReportedTrait[] {
    const scores = result.traitScores;
    if (!scores) return [];

    const definitions = result.module.traits ?? [];

    return definitions.map((definition) => {
      const measured = scores[definition.key];
      const raw = measured?.score ?? 50;

      return {
        key: definition.key,
        label: definition.label,
        // A trait whose workplace label is the opposite pole is flipped here,
        // once, so nothing downstream has to remember to do it.
        score: definition.invertForReport ? round1(100 - raw) : round1(raw),
        confidence: measured?.confidence ?? 0,
      };
    });
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

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
