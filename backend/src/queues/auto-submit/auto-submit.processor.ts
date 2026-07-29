import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SessionsService } from '../../sessions/sessions.service';
import { AUTO_SUBMIT_QUEUE, type AutoSubmitJob } from './auto-submit.job';

/**
 * Fires at a session's hard deadline. This is what makes the timer real when
 * the candidate's browser is closed, offline, or sitting on a stale tab —
 * without it, an abandoned attempt would stay `in_progress` forever.
 *
 * A session the candidate already finished is a no-op: the job is scheduled at
 * start and only removed on a clean finalise, so arriving late is normal.
 */
@Processor(AUTO_SUBMIT_QUEUE)
export class AutoSubmitProcessor extends WorkerHost {
  private readonly logger = new Logger(AutoSubmitProcessor.name);

  constructor(private readonly sessions: SessionsService) {
    super();
  }

  async process(job: Job<AutoSubmitJob>): Promise<void> {
    const submitted = await this.sessions.autoSubmitSession(job.data.sessionId);
    this.logger.log(
      submitted
        ? `Auto-submitted session ${job.data.sessionId} at its deadline`
        : `Session ${job.data.sessionId} was already closed — nothing to do`,
    );
  }
}
