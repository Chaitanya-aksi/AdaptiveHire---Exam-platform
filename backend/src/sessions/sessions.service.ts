import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AdaptiveEngineService } from '../adaptive-engine/adaptive-engine.service';
import { AbilityEstimatorService } from '../adaptive-engine/ability-estimator/ability-estimator.service';
import type { ModuleRunState } from '../adaptive-engine/engine.types';
import type { SelectedQuestion } from '../adaptive-engine/question-selector/question-selector.service';
import { AssessmentsService } from '../assessments/assessments.service';
import {
  InvitationStatus,
  ModuleStopReason,
  ScoringType,
  SessionStatus,
} from '../common/enums';
import { Invitation } from '../invitations/entities/invitation.entity';
import { Question } from '../question-bank/entities/question.entity';
import {
  AUTO_SUBMIT_QUEUE,
  autoSubmitJobId,
  type AutoSubmitJob,
} from '../queues/auto-submit/auto-submit.job';
import {
  REPORT_GENERATION_QUEUE,
  reportJobId,
  type ReportGenerationJob,
} from '../queues/report-generation/report-generation.job';
import { AssessmentSession } from './entities/assessment-session.entity';
import { Response as ResponseRow } from './entities/response.entity';
import { SessionModuleResult } from './entities/session-module-result.entity';
import { RedisSessionService } from './redis-session.service';
import type { ServedQuestion, SessionState } from './session-state';
import type {
  ModuleView,
  QuestionView,
  SessionStep,
  SessionView,
} from './session-views';

/**
 * Slack added to the session's hard deadline for each module, covering the
 * intro screens between modules (which run outside any module's clock).
 */
const INTERMISSION_SECONDS_PER_MODULE = 120;

/** Latency allowance so an answer sent just before the buzzer still counts. */
const ANSWER_GRACE_MS = 2000;

/**
 * Owns the candidate runtime: session lifecycle, the server-authoritative
 * clocks, and the two calls the adaptive engine hangs off (next step, submit
 * answer). Nothing the client sends is trusted beyond "which option did you
 * pick" — the question on screen, the counts and the time left all come from
 * the Redis state this service maintains.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectRepository(AssessmentSession)
    private readonly sessions: Repository<AssessmentSession>,
    @InjectRepository(Invitation)
    private readonly invitations: Repository<Invitation>,
    @InjectRepository(ResponseRow)
    private readonly responses: Repository<ResponseRow>,
    @InjectRepository(SessionModuleResult)
    private readonly moduleResults: Repository<SessionModuleResult>,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
    private readonly assessments: AssessmentsService,
    private readonly engine: AdaptiveEngineService,
    private readonly estimator: AbilityEstimatorService,
    private readonly store: RedisSessionService,
    @InjectQueue(AUTO_SUBMIT_QUEUE)
    private readonly autoSubmit: Queue<AutoSubmitJob>,
    @InjectQueue(REPORT_GENERATION_QUEUE)
    private readonly reportQueue: Queue<ReportGenerationJob>,
  ) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Starts the candidate's attempt, or resumes the one already in flight.
   * `assessment_sessions.invitationId` is unique, so an invitation is worth
   * exactly one attempt — reconnecting always lands back in the same session.
   */
  async start(candidateId: string, invitationId: string): Promise<SessionStep> {
    const invitation = await this.invitations.findOne({
      where: { id: invitationId },
      relations: { assessment: true },
    });

    // Same 404 for "no such invitation" and "not yours" — a candidate should
    // not be able to probe for other people's invitation ids.
    if (!invitation || invitation.candidateId !== candidateId) {
      throw new NotFoundException('Invitation not found');
    }
    if (
      invitation.status === InvitationStatus.REVOKED ||
      invitation.status === InvitationStatus.EXPIRED
    ) {
      throw new ForbiddenException(
        'This invitation is no longer valid. Ask the recruiter to re-send it.',
      );
    }
    if (invitation.expiresAt && invitation.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('This invitation has expired.');
    }

    const existing = await this.sessions.findOne({ where: { invitationId } });
    if (existing) return this.resume(existing);

    return this.createSession(invitation);
  }

  private async createSession(invitation: Invitation): Promise<SessionStep> {
    const assessment = await this.assessments.findOne(invitation.assessmentId);
    if (assessment.modules.length === 0) {
      throw new ConflictException(
        'This assessment has no modules configured yet.',
      );
    }

    const now = Date.now();
    const budgetSeconds = assessment.modules.reduce(
      (total, config) =>
        total + config.timeLimitSeconds + INTERMISSION_SECONDS_PER_MODULE,
      0,
    );
    const expiresAt = now + budgetSeconds * 1000;

    const session = await this.sessions.save(
      this.sessions.create({
        invitationId: invitation.id,
        assessmentId: invitation.assessmentId,
        candidateId: invitation.candidateId as string,
        status: SessionStatus.IN_PROGRESS,
        startedAt: new Date(now),
        expiresAt: new Date(expiresAt),
      }),
    );

    await this.invitations.update(invitation.id, {
      status: InvitationStatus.IN_PROGRESS,
    });

    const state: SessionState = {
      sessionId: session.id,
      candidateId: session.candidateId,
      invitationId: invitation.id,
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      startedAt: now,
      expiresAt,
      status: 'in_progress',
      currentModuleIndex: 0,
      answeredTotal: 0,
      served: null,
      modules: assessment.modules.map((config) =>
        this.engine.createModuleState({
          moduleId: config.moduleId,
          slug: config.module.slug,
          name: config.module.name,
          description: config.module.description,
          scoringType: config.module.scoringType,
          traits: config.module.traits ?? [],
          minQuestions: config.minQuestions,
          maxQuestions: config.maxQuestions,
          timeLimitSeconds: config.timeLimitSeconds,
        }),
      ),
    };

    await this.store.save(state);
    await this.scheduleAutoSubmit(session.id, expiresAt - now);

    this.logger.log(
      `Session ${session.id} started for candidate ${session.candidateId} ` +
        `(${assessment.title}, ${state.modules.length} modules)`,
    );

    return this.advance(state);
  }

  private async resume(session: AssessmentSession): Promise<SessionStep> {
    if (session.status !== SessionStatus.IN_PROGRESS) {
      const state = await this.store.get(session.id);
      return {
        state: 'completed',
        session: state
          ? this.toSessionView(state, session.status)
          : await this.finishedViewFromDb(session),
      };
    }

    const state =
      (await this.store.get(session.id)) ?? (await this.rehydrate(session));

    return this.advance(state);
  }

  // ── The two engine-facing calls ──────────────────────────────────────────

  /** Where the candidate is right now: an intro, a question, or the end. */
  async currentStep(
    candidateId: string,
    sessionId: string,
  ): Promise<SessionStep> {
    return this.advance(await this.load(candidateId, sessionId));
  }

  /**
   * Starts the current module's clock. Explicit rather than automatic so the
   * seconds a candidate spends reading the intro screen aren't taken out of
   * their answering time.
   */
  async startCurrentModule(
    candidateId: string,
    sessionId: string,
  ): Promise<SessionStep> {
    const state = await this.load(candidateId, sessionId);
    const module = state.modules[state.currentModuleIndex];

    if (module && module.status === 'pending') {
      const now = Date.now();
      module.status = 'in_progress';
      module.startedAt = now;
      module.deadlineAt = now + module.timeLimitSeconds * 1000;
      await this.store.startModuleClock(
        state.sessionId,
        module.moduleId,
        module.timeLimitSeconds,
      );
      await this.store.save(state);
    }

    return this.advance(state);
  }

  /**
   * Records an answer and returns the next step. The client never learns
   * whether it was right — that only ever surfaces in the recruiter's report.
   */
  async submitAnswer(
    candidateId: string,
    sessionId: string,
    questionId: string,
    selectedOption: string,
  ): Promise<SessionStep> {
    const state = await this.load(candidateId, sessionId);
    const now = Date.now();

    if (state.status === 'finished') return this.advance(state);
    if (now >= state.expiresAt) {
      await this.finalize(state, SessionStatus.AUTO_SUBMITTED);
      return this.advance(state);
    }

    const served = state.served;
    if (!served) {
      throw new ConflictException(
        'There is no question on screen. Fetch the next one first.',
      );
    }
    if (served.questionId !== questionId) {
      // Stale tab, double submit, or a tampered payload — all the same answer.
      throw new ConflictException(
        'That is not the question you were served. Reload to continue.',
      );
    }

    const module = state.modules[state.currentModuleIndex];
    if (!module || module.moduleId !== served.moduleId) {
      throw new ConflictException('This module has already been closed.');
    }

    // Late by more than the latency grace: the module's clock decides, and
    // `advance` will close it out and score the question as unanswered.
    if (
      module.deadlineAt !== null &&
      now > module.deadlineAt + ANSWER_GRACE_MS
    ) {
      return this.advance(state);
    }

    const question = await this.loadServedQuestion(served.questionId);
    await this.applyAnswer(
      state,
      module,
      question,
      selectedOption,
      served,
      now,
    );
    await this.store.save(state);

    return this.advance(state);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Drives the session forward until it has something for the candidate:
   * the next question, an intro for the module they've just reached, or the
   * completed screen. Every entry point funnels through here so the deadline
   * checks can't be bypassed by calling a different endpoint.
   */
  private async advance(state: SessionState): Promise<SessionStep> {
    if (state.status === 'finished') {
      return { state: 'completed', session: this.toSessionView(state) };
    }

    // Guard against a malformed state costing us an endless loop: two passes
    // per module (close it, then move on) plus one to finalise is the ceiling.
    for (let guard = 0; guard <= state.modules.length * 2 + 2; guard += 1) {
      const now = Date.now();

      if (now >= state.expiresAt) {
        await this.finalize(state, SessionStatus.AUTO_SUBMITTED);
        return { state: 'completed', session: this.toSessionView(state) };
      }

      const module = state.modules[state.currentModuleIndex];
      if (!module) {
        await this.finalize(state, SessionStatus.COMPLETED);
        return { state: 'completed', session: this.toSessionView(state) };
      }

      if (module.status === 'completed') {
        state.currentModuleIndex += 1;
        await this.store.save(state);
        continue;
      }

      if (module.status === 'pending') {
        return {
          state: 'module_intro',
          session: this.toSessionView(state),
          module: this.toModuleView(module),
        };
      }

      // A question is already on screen: re-serve the same one. Refreshing,
      // reconnecting or racing the API can never skip past a question.
      if (state.served && state.served.moduleId === module.moduleId) {
        const timedOut = module.deadlineAt !== null && now >= module.deadlineAt;
        if (!timedOut) {
          return this.toQuestionStep(state, module, state.served);
        }
      }

      const step = await this.engine.nextStep(module, now);
      if (step.kind === 'module_complete') {
        await this.completeModule(state, module, step.reason, now);
        state.currentModuleIndex += 1;
        await this.store.save(state);
        continue;
      }

      state.served = {
        questionId: step.question.id,
        moduleId: module.moduleId,
        servedAt: now,
      };
      // Consumed at serve time, not at answer time: a question the candidate
      // walks away from is still spent.
      module.seenQuestionIds.push(step.question.id);
      await this.store.save(state);

      return this.toQuestionStep(state, module, state.served, step.question);
    }

    throw new Error(`Session ${state.sessionId} could not be advanced`);
  }

  private async applyAnswer(
    state: SessionState,
    module: ModuleRunState,
    question: SelectedQuestion,
    selectedOption: string | null,
    served: ServedQuestion,
    now: number,
  ): Promise<void> {
    const outcome = await this.engine.recordAnswer(
      module,
      question,
      selectedOption,
    );

    state.answeredTotal += 1;

    await this.responses.insert({
      sessionId: state.sessionId,
      moduleId: module.moduleId,
      questionId: question.id,
      selectedOption,
      isCorrect: outcome.isCorrect,
      abilityEstimateAfter: toNumeric(outcome.abilityEstimateAfter),
      questionDifficultyAtServe: toNumeric(outcome.questionDifficultyAtServe),
      sequenceNumber: state.answeredTotal,
      timeTakenMs: Math.max(0, now - served.servedAt),
    });

    state.served = null;
  }

  private async completeModule(
    state: SessionState,
    module: ModuleRunState,
    reason: ModuleStopReason,
    now: number,
  ): Promise<void> {
    // A question still on screen when the clock ran out is scored as
    // unanswered rather than silently dropped — the schema keeps a row for it.
    if (state.served && state.served.moduleId === module.moduleId) {
      const served = state.served;
      const question = await this.loadServedQuestion(served.questionId);
      await this.applyAnswer(state, module, question, null, served, now);
    }

    module.status = 'completed';
    module.completedAt = now;
    module.stopReason = reason;
    await this.store.clearModuleClock(state.sessionId, module.moduleId);
    await this.persistModuleResult(state.sessionId, module);

    this.logger.log(
      `Session ${state.sessionId}: module ${module.slug} closed after ` +
        `${module.answered} question(s) — ${reason}`,
    );
  }

  private async persistModuleResult(
    sessionId: string,
    module: ModuleRunState,
  ): Promise<void> {
    // A module the candidate never reached gets a row with null scores rather
    // than the untouched starting estimate, which would read as a real result.
    const attempted = module.answered > 0;

    await this.moduleResults.upsert(
      {
        sessionId,
        moduleId: module.moduleId,
        abilityScore: attempted
          ? toNumeric(this.engine.finalAbility(module))
          : null,
        traitScores: attempted ? this.engine.finalTraitScores(module) : null,
        questionsAnswered: module.answered,
        questionsCorrect: module.correct,
        stopReason: module.stopReason,
        startedAt: module.startedAt ? new Date(module.startedAt) : null,
        completedAt: module.completedAt ? new Date(module.completedAt) : null,
      },
      ['sessionId', 'moduleId'],
    );
  }

  /**
   * Closes the session out. Safe to call twice — the auto-submit worker and a
   * candidate finishing normally can race, and whichever lands second is a
   * no-op.
   */
  async finalize(state: SessionState, status: SessionStatus): Promise<void> {
    if (state.status === 'finished') return;

    const now = Date.now();
    for (const module of state.modules) {
      if (module.status === 'in_progress') {
        module.status = 'completed';
        module.completedAt = now;
        module.stopReason ??= ModuleStopReason.TIME_EXPIRED;
      }
      // Every configured module gets a row, including ones never reached, so
      // the report is one query rather than a diff against the assessment.
      await this.persistModuleResult(state.sessionId, module);
    }

    state.status = 'finished';
    state.served = null;
    await this.store.save(state);

    await this.sessions.update(state.sessionId, {
      status,
      submittedAt: new Date(now),
    });
    await this.invitations.update(state.invitationId, {
      status: InvitationStatus.COMPLETED,
    });
    await this.removeAutoSubmit(state.sessionId);
    await this.enqueueReport(state.sessionId);

    this.logger.log(`Session ${state.sessionId} finalised as ${status}`);
  }

  /**
   * Report generation is asynchronous by design — the candidate lands on the
   * confirmation screen immediately rather than waiting on it. Enqueueing is
   * best-effort: if the queue is unreachable the recruiter's first read of the
   * report builds it instead.
   */
  private async enqueueReport(sessionId: string): Promise<void> {
    try {
      await this.reportQueue.add(
        'generate',
        { sessionId },
        {
          jobId: reportJobId(sessionId),
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch (error) {
      this.logger.error(
        `Could not queue report generation for ${sessionId}: ${describe(error)}`,
      );
    }
  }

  /** Entry point for the BullMQ auto-submit worker (no candidate context). */
  async autoSubmitSession(sessionId: string): Promise<boolean> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session || session.status !== SessionStatus.IN_PROGRESS) return false;

    const state =
      (await this.store.get(sessionId)) ?? (await this.rehydrate(session));
    await this.finalize(state, SessionStatus.AUTO_SUBMITTED);
    return true;
  }

  // ── State plumbing ───────────────────────────────────────────────────────

  private async load(
    candidateId: string,
    sessionId: string,
  ): Promise<SessionState> {
    const state = await this.store.get(sessionId);
    if (state) {
      if (state.candidateId !== candidateId) {
        throw new NotFoundException('Session not found');
      }
      return state;
    }

    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session || session.candidateId !== candidateId) {
      throw new NotFoundException('Session not found');
    }
    return this.rehydrate(session);
  }

  /**
   * Rebuilds live state from the durable record after Redis has lost it
   * (restart, eviction). `responses` holds every answer, so the run can be
   * replayed exactly; only the module clocks are unrecoverable, and those
   * restart — being generous with time beats voiding an attempt, and an
   * invitation is worth only one session so a fresh start isn't an option.
   */
  private async rehydrate(session: AssessmentSession): Promise<SessionState> {
    this.logger.warn(
      `Rebuilding session ${session.id} from the database — live state was gone`,
    );

    const assessment = await this.assessments.findOne(session.assessmentId);
    const modules = assessment.modules.map((config) =>
      this.engine.createModuleState({
        moduleId: config.moduleId,
        slug: config.module.slug,
        name: config.module.name,
        description: config.module.description,
        scoringType: config.module.scoringType,
        traits: config.module.traits ?? [],
        minQuestions: config.minQuestions,
        maxQuestions: config.maxQuestions,
        timeLimitSeconds: config.timeLimitSeconds,
      }),
    );

    const answers = await this.responses.find({
      where: { sessionId: session.id },
      relations: { question: { personalityDetails: true } },
      order: { sequenceNumber: 'ASC' },
    });

    for (const answer of answers) {
      const module = modules.find((m) => m.moduleId === answer.moduleId);
      if (!module) continue;

      module.seenQuestionIds.push(answer.questionId);
      module.answered += 1;
      module.status = 'in_progress';

      if (module.scoringType === ScoringType.OBJECTIVE) {
        const difficulty = Number(answer.questionDifficultyAtServe ?? 0);
        // Information is measured against the estimate the question was
        // chosen for, i.e. the value before this answer moved it.
        module.information += this.estimator.information(
          module.ability,
          difficulty,
        );
        module.ability = Number(answer.abilityEstimateAfter ?? module.ability);
        this.estimator.trackAbility(module, module.ability);
        if (answer.isCorrect) module.correct += 1;
      } else if (answer.selectedOption) {
        const chosen = answer.question.personalityDetails?.options.find(
          (option) => option.key === answer.selectedOption,
        );
        if (chosen) {
          this.estimator.applyTraitWeights(
            module.traitTallies,
            chosen.traitWeights,
          );
        }
      }
    }

    // Any module already written to session_module_results is finished.
    const finished = await this.moduleResults.find({
      where: { sessionId: session.id },
    });
    for (const result of finished) {
      const module = modules.find((m) => m.moduleId === result.moduleId);
      if (!module || result.completedAt === null) continue;
      module.status = 'completed';
      module.stopReason = result.stopReason;
      module.completedAt = result.completedAt.getTime();
    }

    const now = Date.now();
    for (const module of modules) {
      if (module.status !== 'in_progress') continue;
      module.startedAt = now;
      module.deadlineAt = now + module.timeLimitSeconds * 1000;
      await this.store.startModuleClock(
        session.id,
        module.moduleId,
        module.timeLimitSeconds,
      );
    }

    const firstUnfinished = modules.findIndex((m) => m.status !== 'completed');

    const state: SessionState = {
      sessionId: session.id,
      candidateId: session.candidateId,
      invitationId: session.invitationId,
      assessmentId: session.assessmentId,
      assessmentTitle: assessment.title,
      startedAt: session.startedAt.getTime(),
      expiresAt: session.expiresAt.getTime(),
      status:
        session.status === SessionStatus.IN_PROGRESS
          ? 'in_progress'
          : 'finished',
      currentModuleIndex:
        firstUnfinished === -1 ? modules.length : firstUnfinished,
      answeredTotal: answers.length,
      served: null,
      modules,
    };

    await this.store.save(state);
    return state;
  }

  private async loadServedQuestion(
    questionId: string,
  ): Promise<SelectedQuestion> {
    const question = await this.questions.findOne({
      where: { id: questionId },
      relations: { mcqDetails: true, personalityDetails: true },
    });
    if (!question) {
      throw new NotFoundException(`Question ${questionId} no longer exists`);
    }
    return question;
  }

  // ── Views ────────────────────────────────────────────────────────────────

  private async toQuestionStep(
    state: SessionState,
    module: ModuleRunState,
    served: ServedQuestion,
    preloaded?: SelectedQuestion,
  ): Promise<SessionStep> {
    const question =
      preloaded ?? (await this.loadServedQuestion(served.questionId));
    const remaining = await this.store.moduleRemainingMs(
      state.sessionId,
      module.moduleId,
    );

    return {
      state: 'question',
      session: this.toSessionView(state),
      module: this.toModuleView(module),
      question: this.toQuestionView(question, module),
      sequenceNumber: state.answeredTotal + 1,
      moduleProgress: {
        answered: module.answered,
        min: module.minQuestions,
        max: module.maxQuestions,
      },
      moduleRemainingMs:
        remaining ??
        Math.max(0, (module.deadlineAt ?? Date.now()) - Date.now()),
    };
  }

  /** Strips the correct answer and the trait weights before they leave the API. */
  private toQuestionView(
    question: SelectedQuestion,
    module: ModuleRunState,
  ): QuestionView {
    const options =
      module.scoringType === ScoringType.OBJECTIVE
        ? (question.mcqDetails?.options ?? [])
        : (question.personalityDetails?.options ?? []);

    return {
      id: question.id,
      text: question.questionText,
      options: options.map((option) => ({
        key: option.key,
        text: option.text,
      })),
    };
  }

  private toModuleView(module: ModuleRunState): ModuleView {
    return {
      moduleId: module.moduleId,
      name: module.name,
      slug: module.slug,
      description: module.description,
      scoringType: module.scoringType,
      status: module.status,
      minQuestions: module.minQuestions,
      maxQuestions: module.maxQuestions,
      timeLimitSeconds: module.timeLimitSeconds,
      answered: module.answered,
    };
  }

  private toSessionView(
    state: SessionState,
    status?: SessionStatus,
  ): SessionView {
    return {
      sessionId: state.sessionId,
      assessmentId: state.assessmentId,
      assessmentTitle: state.assessmentTitle,
      status:
        status ??
        (state.status === 'finished'
          ? SessionStatus.COMPLETED
          : SessionStatus.IN_PROGRESS),
      startedAt: new Date(state.startedAt).toISOString(),
      expiresAt: new Date(state.expiresAt).toISOString(),
      sessionRemainingMs: Math.max(0, state.expiresAt - Date.now()),
      currentModuleIndex: state.currentModuleIndex,
      modules: state.modules.map((module) => this.toModuleView(module)),
    };
  }

  /** Last resort when a finished session's state has aged out of Redis. */
  private async finishedViewFromDb(
    session: AssessmentSession,
  ): Promise<SessionView> {
    const assessment = await this.assessments.findOne(session.assessmentId);
    const results = await this.moduleResults.find({
      where: { sessionId: session.id },
    });

    return {
      sessionId: session.id,
      assessmentId: session.assessmentId,
      assessmentTitle: assessment.title,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      sessionRemainingMs: 0,
      currentModuleIndex: assessment.modules.length,
      modules: assessment.modules.map((config) => ({
        moduleId: config.moduleId,
        name: config.module.name,
        slug: config.module.slug,
        description: config.module.description,
        scoringType: config.module.scoringType,
        status: 'completed' as const,
        minQuestions: config.minQuestions,
        maxQuestions: config.maxQuestions,
        timeLimitSeconds: config.timeLimitSeconds,
        answered:
          results.find((r) => r.moduleId === config.moduleId)
            ?.questionsAnswered ?? 0,
      })),
    };
  }

  // ── Auto-submit scheduling ───────────────────────────────────────────────

  private async scheduleAutoSubmit(
    sessionId: string,
    delayMs: number,
  ): Promise<void> {
    try {
      await this.autoSubmit.add(
        'auto-submit',
        { sessionId },
        {
          jobId: autoSubmitJobId(sessionId),
          delay: Math.max(0, delayMs),
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch (error) {
      // The deadline is still enforced on every request; the job only covers
      // the case where the candidate's browser is gone.
      this.logger.error(
        `Could not schedule auto-submit for ${sessionId}: ${describe(error)}`,
      );
    }
  }

  private async removeAutoSubmit(sessionId: string): Promise<void> {
    try {
      await this.autoSubmit.remove(autoSubmitJobId(sessionId));
    } catch {
      // Already gone, or the job is mid-run. Either way finalize is idempotent.
    }
  }
}

/** TypeORM maps `numeric` columns to strings; keep the conversion in one place. */
function toNumeric(value: number | null): string | null {
  return value === null ? null : String(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
