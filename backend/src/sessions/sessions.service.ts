import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { QueryFailedError, Repository } from 'typeorm';
import {
  AdaptiveEngineService,
  type SubmittedAnswer,
} from '../adaptive-engine/adaptive-engine.service';
import { AbilityEstimatorService } from '../adaptive-engine/ability-estimator/ability-estimator.service';
import { effectiveWindow, windowState } from '../assessments/assessment-window';
import type { ModuleRunState } from '../adaptive-engine/engine.types';
import { EvaluationService } from '../adaptive-engine/evaluation/evaluation.service';
import type { SelectedQuestion } from '../adaptive-engine/question-selector/question-selector.service';
import { PersonalityQuestionDetails } from '../question-bank/entities/personality-question-details.entity';
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
import { SubmitAnswerDto } from './dto/submit-answer.dto';
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

/**
 * How long a candidate may sit on the very first intro screen before the
 * session is abandoned.
 *
 * Two hours. Nothing is being measured while they are there — the real clock
 * does not start until they press Begin — so this exists only to stop a
 * session sitting `in_progress` forever if somebody opens the runtime and
 * walks away. The invitation's own window is what actually governs when an
 * assessment may be sat.
 */
const START_GRACE_SECONDS = 7200;

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
    private readonly evaluation: EvaluationService,
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
    /*
     * The scheduled window, checked before anything is created.
     *
     * Replaces a bare `expiresAt` comparison, which knew nothing about the
     * assessment's own window and so could not express "this round opens on
     * Tuesday". The two ends are resolved in `effectiveWindow` so this and the
     * candidate's assessment list always agree — a button that works while the
     * copy beside it says the test has not opened is worse than either.
     *
     * Only checked on the way in. A candidate who started inside the window and
     * is still working when it closes keeps their session: the module clock and
     * the auto-submit job already bound how long they have, and cutting them
     * off mid-question would take an attempt away for being slow.
     */
    const state = windowState(
      effectiveWindow(invitation.assessment, invitation),
    );

    if (state === 'not_yet') {
      throw new ForbiddenException('This assessment has not opened yet.');
    }
    if (state === 'closed') {
      throw new ForbiddenException('This assessment has closed.');
    }

    const existing = await this.sessions.findOne({ where: { invitationId } });
    if (existing) return this.resume(existing);

    try {
      return await this.createSession(invitation);
    } catch (error) {
      // Two starts for one invitation raced each other — a double-click, two
      // tabs, or React's development double-mount. `invitationId` is unique, so
      // one insert wins and the other lands here. The loser joins the session
      // the winner created instead of failing: from the candidate's side both
      // clicks meant "let me in", and they used to get a 500 for the second.
      if (!isUniqueViolation(error)) throw error;

      const winner = await this.sessions.findOne({ where: { invitationId } });
      if (!winner) throw error;

      this.logger.warn(
        `Concurrent start for invitation ${invitationId} — joining session ` +
          `${winner.id} created by the call that won the race`,
      );
      return this.resume(winner);
    }
  }

  private async createSession(invitation: Invitation): Promise<SessionStep> {
    const assessment = await this.assessments.findOneForSession(
      invitation.assessmentId,
    );
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

    /*
     * A placeholder deadline, rebased by `beginSessionClock` the moment the
     * first module actually starts.
     *
     * It is not simply "now + budget" any more, because that is what let a
     * candidate's whole allowance drain while they read the first intro
     * screen. `START_GRACE_SECONDS` is the window they have to press Begin at
     * all — generous, because nothing is being measured yet and the invitation
     * window is the real bound on when they may sit it — and the budget itself
     * does not begin until they do.
     */
    const expiresAt = now + (budgetSeconds + START_GRACE_SECONDS) * 1000;

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

    // Resolved once per session: an empty pool means "no restriction", so the
    // selector should not pay for a subquery discovering that on every question.
    const poolRestricted = assessment.questionPool.length > 0;

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
          // The assessment's owner, not the candidate's — a candidate belongs to
          // no organisation, and this is what scopes the questions they are served.
          organisationId: assessment.organisationId,
          assessmentId: assessment.id,
          poolRestricted,
          slug: config.module.slug,
          name: config.module.name,
          description: config.module.description,
          scoringType: config.module.scoringType,
          traits: config.module.traits ?? [],
          questionCount: config.questionCount,
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
   *
   * **Beginning the first module is also when the session's own deadline
   * starts.** It used to start at `createSession`, which is the moment the
   * candidate's browser loads the runtime — so the whole budget burned while
   * they sat on the very first intro screen reading it, and an attempt could
   * auto-submit with zero answers before a single question had been served.
   * The per-module clock was always correct; the session clock above it was
   * not, and it is the one auto-submit fires on.
   */
  async startCurrentModule(
    candidateId: string,
    sessionId: string,
  ): Promise<SessionStep> {
    const state = await this.load(candidateId, sessionId);
    const module = state.modules[state.currentModuleIndex];

    if (module && module.status === 'pending') {
      const now = Date.now();

      // Read before the status below changes it: this is the first module to
      // start when nothing has started yet.
      const isFirst = state.modules.every((m) => m.status === 'pending');

      module.status = 'in_progress';
      module.startedAt = now;
      module.deadlineAt = now + module.timeLimitSeconds * 1000;
      await this.store.startModuleClock(
        state.sessionId,
        module.moduleId,
        module.timeLimitSeconds,
      );

      if (isFirst) await this.beginSessionClock(state, now);

      await this.store.save(state);
    }

    return this.advance(state);
  }

  /**
   * Rebases the session's deadline to the moment the assessment actually
   * began.
   *
   * `startedAt` moves with it, and deliberately. A recruiter reads the elapsed
   * time as how long the attempt took; left at session-creation it would
   * include however long the candidate spent on the intro screen — eight hours,
   * if they opened it in the morning and sat it after lunch.
   *
   * The queued job has to be removed before the replacement is added: BullMQ
   * keys on `jobId` and silently keeps the existing job rather than replacing
   * it, so adding alone would leave the original — now far too early —
   * deadline in place.
   */
  private async beginSessionClock(
    state: SessionState,
    now: number,
  ): Promise<void> {
    const budgetMs = state.modules.reduce(
      (total, module) =>
        total +
        (module.timeLimitSeconds + INTERMISSION_SECONDS_PER_MODULE) * 1000,
      0,
    );

    state.startedAt = now;
    state.expiresAt = now + budgetMs;

    await this.sessions.update(state.sessionId, {
      startedAt: new Date(now),
      expiresAt: new Date(state.expiresAt),
    });

    await this.removeAutoSubmit(state.sessionId);
    await this.scheduleAutoSubmit(state.sessionId, budgetMs);
  }

  /**
   * Records an answer and returns the next step. The client never learns
   * whether it was right — that only ever surfaces in the recruiter's report.
   */
  async submitAnswer(
    candidateId: string,
    sessionId: string,
    dto: SubmitAnswerDto,
  ): Promise<SessionStep> {
    const { questionId } = dto;
    const answer = toSubmittedAnswer(dto);
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
    await this.applyAnswer(state, module, question, answer, served, now);
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
      // walks away from is still spent, and its probe twin must stay out of the
      // paper either way.
      module.seenQuestionIds.push(step.question.id);
      this.engine.markProbeServed(module, step.question);
      await this.store.save(state);

      return this.toQuestionStep(state, module, state.served, step.question);
    }

    throw new Error(`Session ${state.sessionId} could not be advanced`);
  }

  private async applyAnswer(
    state: SessionState,
    module: ModuleRunState,
    question: SelectedQuestion,
    answer: SubmittedAnswer,
    served: ServedQuestion,
    now: number,
  ): Promise<void> {
    // The sequence number is settled before scoring so a probe pair can record
    // which two rows of the session's answer list it is made of.
    state.answeredTotal += 1;
    const outcome = await this.engine.recordAnswer(
      module,
      question,
      answer,
      state.answeredTotal,
    );

    await this.responses.insert({
      sessionId: state.sessionId,
      moduleId: module.moduleId,
      questionId: question.id,
      // Exactly one of these is set on an answered question; both stay null
      // when the clock ran out with it on screen.
      selectedOption: answer.kind === 'option' ? answer.selectedOption : null,
      selectedOptions:
        answer.kind === 'ranking' ? answer.selectedOptions : null,
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
      await this.applyAnswer(
        state,
        module,
        question,
        { kind: 'unanswered' },
        served,
        now,
      );
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
        probeResults: attempted ? this.engine.probeResults(module) : null,
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

    const assessment = await this.assessments.findOneForSession(
      session.assessmentId,
    );
    const poolRestricted = assessment.questionPool.length > 0;

    const modules = assessment.modules.map((config) =>
      this.engine.createModuleState({
        moduleId: config.moduleId,
        organisationId: assessment.organisationId,
        assessmentId: assessment.id,
        poolRestricted,
        slug: config.module.slug,
        name: config.module.name,
        description: config.module.description,
        scoringType: config.module.scoringType,
        traits: config.module.traits ?? [],
        questionCount: config.questionCount,
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

      // Whether this answer can be compared with its probe twin at all: a
      // question the clock ran out on has no choice to compare.
      const wasAnswered =
        answer.selectedOption !== null ||
        Boolean(answer.selectedOptions?.length);

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

        this.engine.replayProbe(
          module,
          answer.question,
          answer.sequenceNumber,
          wasAnswered
            ? { kind: 'objective', isCorrect: answer.isCorrect === true }
            : { kind: 'unanswered' },
        );
      } else {
        // Replay the trait contribution through the engine rather than
        // re-deriving it here. A ranking answer's weights depend on the
        // position of every option, so reading `selectedOption` alone (which
        // is null for rankings) would silently drop the whole answer.
        const details = answer.question.personalityDetails;
        const replayed = details
          ? this.replayTraitAnswer(details, answer)
          : null;
        if (replayed) {
          this.estimator.applyTraitWeights(module.traitTallies, replayed);
        }
        if (details?.pattern) {
          module.patternCounts[details.pattern] =
            (module.patternCounts[details.pattern] ?? 0) + 1;
        }

        this.engine.replayProbe(
          module,
          answer.question,
          answer.sequenceNumber,
          // An answer whose weights could not be replayed is uncomparable
          // rather than a disagreement — same treatment as a timeout.
          wasAnswered && replayed
            ? { kind: 'trait', weights: replayed }
            : { kind: 'unanswered' },
        );
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

  /**
   * Trait weights for one stored answer, replayed during rehydration.
   *
   * Returns null for a question that timed out unanswered — it contributed
   * nothing at the time and must contribute nothing now. Evaluation errors are
   * swallowed rather than thrown: a question edited since it was answered
   * should cost that one answer's contribution, not the candidate's session.
   */
  private replayTraitAnswer(
    details: PersonalityQuestionDetails,
    answer: ResponseRow,
  ): Record<string, number> | null {
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
    } catch (error) {
      this.logger.warn(
        `Could not replay answer ${answer.id} while rebuilding session ` +
          `${answer.sessionId}: ${describe(error)}`,
      );
    }
    return null;
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
        questionCount: module.questionCount,
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
      pattern: question.personalityDetails?.pattern ?? null,
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
      questionCount: module.questionCount,
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
    const assessment = await this.assessments.findOneForSession(
      session.assessmentId,
    );
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
        questionCount: config.questionCount,
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

/**
 * Turns the request payload into the engine's answer union, rejecting the two
 * ambiguous cases. Whether the shape actually suits the question that was
 * served is a separate check, made by the engine against the stored pattern.
 */
function toSubmittedAnswer(dto: SubmitAnswerDto): SubmittedAnswer {
  const hasOption = dto.selectedOption !== undefined;
  const hasRanking = dto.selectedOptions !== undefined;

  if (hasOption && hasRanking) {
    throw new BadRequestException(
      'Send either "selectedOption" or "selectedOptions", not both',
    );
  }
  if (hasRanking) {
    return { kind: 'ranking', selectedOptions: dto.selectedOptions! };
  }
  if (hasOption) {
    return { kind: 'option', selectedOption: dto.selectedOption! };
  }
  throw new BadRequestException(
    'An answer needs "selectedOption", or "selectedOptions" for a ranking',
  );
}

/** TypeORM maps `numeric` columns to strings; keep the conversion in one place. */
function toNumeric(value: number | null): string | null {
  return value === null ? null : String(value);
}

/**
 * Postgres `unique_violation`. Matched on the SQLSTATE rather than the message
 * so it survives a driver upgrade or a non-English server locale.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as QueryFailedError & { code?: string }).code === '23505'
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
