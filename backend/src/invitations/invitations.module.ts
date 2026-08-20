import { Module } from '@nestjs/common';
import { MailQueueModule } from '../queues/invite-emails/mail-queue.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentsModule } from '../assessments/assessments.module';
import { QuestionBankModule } from '../question-bank/question-bank.module';
import { Report } from '../reports/entities/report.entity';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { Response } from '../sessions/entities/response.entity';
import { SessionModuleResult } from '../sessions/entities/session-module-result.entity';
import { InviteEmailsProcessor } from '../queues/invite-emails/invite-emails.processor';
import { UsersModule } from '../users/users.module';
import { Invitation } from './entities/invitation.entity';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [
    // Everything but Invitation is read-only here. AssessmentSession because
    // deleting an invitation has to know whether an attempt already hangs off
    // it; the other three because the candidate's own attempt view is served
    // from this module, off the invitation they reached it by.
    TypeOrmModule.forFeature([
      Invitation,
      AssessmentSession,
      SessionModuleResult,
      Response,
      Report,
    ]),
    // Registers the queue here so the service can inject its producer and the
    // processor below is attached as its worker.
    MailQueueModule,
    UsersModule,
    AssessmentsModule,
    // For PracticeService — the pre-assessment rehearsal is served from here,
    // off the invitation the candidate reached it by.
    QuestionBankModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService, InviteEmailsProcessor],
  exports: [InvitationsService],
})
export class InvitationsModule {}
