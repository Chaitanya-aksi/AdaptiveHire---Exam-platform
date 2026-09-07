import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { SessionStatus } from '../common/enums';
import { AssessmentSession } from './entities/assessment-session.entity';
import { SessionsService } from './sessions.service';

/**
 * How long past its deadline a session must be before this will touch it.
 *
 * The delayed BullMQ job gets first refusal — this is a backstop, not a
 * competitor. A session one second past its deadline is almost certainly about
 * to be closed by the queue, and racing it would just do the same idempotent
 * work twice on an instance with a tenth of a CPU.
 */
const GRACE_MS = 2 * 60 * 1000;

/**
 * Waiting period before the sweep runs, so it does not compete with whatever
 * request woke the instance. A cold start is exactly when this runs and also
 * exactly when someone is waiting on a page.
 */
const STARTUP_DELAY_MS = 15 * 1000;

/**
 * How many to close in one pass. Sequential and capped on purpose: the free
 * instance has 0.1 CPU and a five-connection pool, and finalising a session
 * writes results, responses and a queued report. A pathological backlog should
 * be worked through over several restarts rather than stalling one boot.
 */
const MAX_PER_SWEEP = 50;

/**
 * Closes sessions whose deadline passed while nothing was listening.
 *
 * Three mechanisms are meant to stop an attempt sitting `in_progress` forever,
 * and each has a hole the next one covers:
 *
 * 1. **Every request re-checks the deadline** (`sessions.service.ts`), so a
 *    candidate with the page open cannot answer past their time. Useless if
 *    their browser is gone — which is the whole case that needs covering.
 * 2. **A delayed BullMQ job** fires at the deadline. It needs a live worker, so
 *    it fires late if the instance is asleep, and it now retries three times if
 *    the database blinks. But `scheduleAutoSubmit` deliberately swallows a
 *    queue failure at *start* time, so a session can exist with no job at all;
 *    and three failed attempts exhaust it for good.
 * 3. **This sweep**, which needs neither a live worker at the right moment nor
 *    a job to have survived. It asks the database directly: is anything still
 *    open past its deadline? That question is answerable from `expiresAt`
 *    alone, so it holds however the job was lost.
 *
 * It runs on boot rather than on a timer because the free instance sleeps when
 * idle: a wake is the moment when time has passed unobserved, and the keep-alive
 * ping means a wake happens within minutes of anything going wrong.
 */
@Injectable()
export class ExpiredSessionSweeper
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ExpiredSessionSweeper.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @InjectRepository(AssessmentSession)
    private readonly sessions: Repository<AssessmentSession>,
    private readonly runtime: SessionsService,
  ) {}

  onApplicationBootstrap(): void {
    // Deliberately not awaited: bootstrap must not wait on a database sweep,
    // and nothing else depends on its result.
    this.timer = setTimeout(() => {
      void this.sweep();
    }, STARTUP_DELAY_MS);

    // Node keeps the process alive for a pending timer, which would hold up a
    // shutdown that arrives inside the delay window.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /**
   * Never throws. A failure here must not stop an instance serving, and the
   * queue path is still the primary mechanism — this going wrong should be a
   * log line, not an outage.
   */
  private async sweep(): Promise<void> {
    try {
      const overdue = await this.sessions.find({
        where: {
          status: SessionStatus.IN_PROGRESS,
          expiresAt: LessThanOrEqual(new Date(Date.now() - GRACE_MS)),
        },
        select: { id: true },
        order: { expiresAt: 'ASC' },
        take: MAX_PER_SWEEP,
      });

      if (overdue.length === 0) return;

      this.logger.warn(
        `${overdue.length} session(s) are past their deadline and still open — ` +
          'closing them now. Each one means the auto-submit job did not run.',
      );

      let closed = 0;
      for (const { id } of overdue) {
        try {
          // Idempotent: returns false unless the session is still in progress,
          // so racing the queue is harmless.
          if (await this.runtime.autoSubmitSession(id)) closed++;
        } catch (error) {
          // One bad session must not abandon the rest of the batch.
          this.logger.error(
            `Could not close expired session ${id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      this.logger.log(
        `Closed ${closed} of ${overdue.length} expired session(s)` +
          (overdue.length === MAX_PER_SWEEP
            ? '. Batch was capped; the rest are picked up on the next restart.'
            : '.'),
      );
    } catch (error) {
      this.logger.error(
        `Expired-session sweep failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
