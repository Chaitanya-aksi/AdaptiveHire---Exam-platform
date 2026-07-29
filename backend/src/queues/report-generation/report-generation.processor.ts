import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ReportsService } from '../../reports/reports.service';
import {
  REPORT_GENERATION_QUEUE,
  type ReportGenerationJob,
} from './report-generation.job';

/**
 * Builds a session's report off the request path. The candidate presses submit
 * and lands on the confirmation screen immediately — they never wait on this,
 * and a failure here can't fail their attempt.
 *
 * A thrown error lets BullMQ retry. If every retry fails, the recruiter's
 * first read of the report regenerates it, so a lost job degrades to a slower
 * page rather than a missing report.
 */
@Processor(REPORT_GENERATION_QUEUE)
export class ReportGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportGenerationProcessor.name);

  constructor(private readonly reports: ReportsService) {
    super();
  }

  async process(job: Job<ReportGenerationJob>): Promise<void> {
    await this.reports.generate(job.data.sessionId);
    this.logger.log(`Report job ${job.id} completed`);
  }
}
