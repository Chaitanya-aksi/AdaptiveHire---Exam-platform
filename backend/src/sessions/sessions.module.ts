import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdaptiveEngineModule } from '../adaptive-engine/adaptive-engine.module';
import { AssessmentsModule } from '../assessments/assessments.module';
import { Invitation } from '../invitations/entities/invitation.entity';
import { Question } from '../question-bank/entities/question.entity';
import { AUTO_SUBMIT_QUEUE } from '../queues/auto-submit/auto-submit.job';
import { AutoSubmitProcessor } from '../queues/auto-submit/auto-submit.processor';
import { REPORT_GENERATION_QUEUE } from '../queues/report-generation/report-generation.job';
import { AssessmentSession } from './entities/assessment-session.entity';
import { Response } from './entities/response.entity';
import { SessionModuleResult } from './entities/session-module-result.entity';
import { RedisSessionService } from './redis-session.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AssessmentSession,
      SessionModuleResult,
      Response,
      Invitation,
      Question,
    ]),
    BullModule.registerQueue({ name: AUTO_SUBMIT_QUEUE }),
    // Producer only — the worker lives in ReportsModule, next to the service
    // that does the work.
    BullModule.registerQueue({ name: REPORT_GENERATION_QUEUE }),
    AdaptiveEngineModule,
    AssessmentsModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService, RedisSessionService, AutoSubmitProcessor],
  exports: [SessionsService],
})
export class SessionsModule {}
