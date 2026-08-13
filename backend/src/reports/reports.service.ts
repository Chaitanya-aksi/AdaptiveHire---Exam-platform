import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EvaluationService } from '../adaptive-engine/evaluation/evaluation.service';
import { AssessmentModule } from '../assessments/entities/assessment-module.entity';
import { Assessment } from '../assessments/entities/assessment.entity';
import {
  BehavioralPattern,
  HiringRecommendation,
  ProctoringEventType,
  ScoringType,
  SessionStatus,
} from '../common/enums';
import { ProctoringLog } from '../proctoring/entities/proctoring-log.entity';
import type { PersonalityOption } from '../question-bank/entities/personality-question-details.entity';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { Response as ResponseRow } from '../sessions/entities/response.entity';
import { SessionModuleResult } from '../sessions/entities/session-module-result.entity';
import {
  buildBehavioralProfiles,
  type ProfileScore,
} from './behavioral-profiles';
import { Report } from './entities/report.entity';
import {
  buildReport,
  normaliseAbility,
  type ModuleSummary,
  type ProbeSummary,
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

export interface AttemptListItem {
  sessionId: string;
  candidate: { id: string; fullName: string; email: string };
  status: SessionStatus;
  startedAt: string;
  submittedAt: string | null;
  questionsAnswered: number;
  overallScore: number | null;
  /** The two halves behind it, so a blended figure is never unexplained. */
  abilityScore: number | null;
  behavioralScore: number | null;
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
    @InjectRepository(Assessment)
    private readonly assessments: Repository<Assessment>,
    @InjectRepository(ResponseRow)
    private readonly responses: Repository<ResponseRow>,
    @InjectRepository(ProctoringLog)
    private readonly logs: Repository<ProctoringLog>,
    // Reused rather than reimplemented: the evidence view must show the same
    // weights the engine scored with, including a ranking's position factors.
    private readonly evaluation: EvaluationService,
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

    return this.reports.findOneOrFail({ where: { sessionId } });
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
        overallScore: toNumber(report?.overallScore ?? null),
        abilityScore: toNumber(report?.abilityScore ?? null),
        behavioralScore: toNumber(report?.behavioralScore ?? null),
        hiringRecommendation: report?.hiringRecommendation ?? null,
        violationCount: events.filter((event) => event.sessionId === session.id)
          .length,
      };
    });
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
