import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailQueueModule } from '../queues/invite-emails/mail-queue.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdaptiveEngineModule } from '../adaptive-engine/adaptive-engine.module';
import { AssessmentModule } from '../assessments/entities/assessment-module.entity';
import { Assessment } from '../assessments/entities/assessment.entity';
import { Organisation } from '../organisations/entities/organisation.entity';
import { ProctoringLog } from '../proctoring/entities/proctoring-log.entity';
import { REPORT_GENERATION_QUEUE } from '../queues/report-generation/report-generation.job';
import { ReportGenerationProcessor } from '../queues/report-generation/report-generation.processor';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { Response } from '../sessions/entities/response.entity';
import { User } from '../users/entities/user.entity';
import { SessionModuleResult } from '../sessions/entities/session-module-result.entity';
import { CandidateMessage } from './entities/candidate-message.entity';
import { CandidateReview } from './entities/candidate-review.entity';
import { Report } from './entities/report.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Report,
      CandidateReview,
      CandidateMessage,
      Assessment,
      AssessmentSession,
      SessionModuleResult,
      AssessmentModule,
      Response,
      ProctoringLog,
      // Read-only: finding who to notify when an attempt completes.
      User,
      // Read-only: a rejection email goes out under the hiring company's name,
      // with their support address as Reply-To.
      Organisation,
    ]),
    // Registered here so the worker lives with the service it calls; the
    // sessions module registers the same queue to enqueue onto it.
    BullModule.registerQueue({ name: REPORT_GENERATION_QUEUE }),
    // For EvaluationService — the evidence view re-derives each answer's trait
    // weights through the same code that scored them.
    AdaptiveEngineModule,
    // Producer only — the worker for this queue lives in InvitationsModule.
    // Used to tell whoever owns a requisition that somebody finished it.
    MailQueueModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ReportGenerationProcessor],
  exports: [ReportsService],
})
export class ReportsModule {}
