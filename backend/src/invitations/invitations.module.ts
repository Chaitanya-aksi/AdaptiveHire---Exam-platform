import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentsModule } from '../assessments/assessments.module';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { INVITE_EMAILS_QUEUE } from '../queues/invite-emails/invite-emails.job';
import { InviteEmailsProcessor } from '../queues/invite-emails/invite-emails.processor';
import { UsersModule } from '../users/users.module';
import { Invitation } from './entities/invitation.entity';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [
    // AssessmentSession is read-only here: deleting an invitation has to know
    // whether an attempt already hangs off it.
    TypeOrmModule.forFeature([Invitation, AssessmentSession]),
    // Registers the queue here so the service can inject its producer and the
    // processor below is attached as its worker.
    BullModule.registerQueue({ name: INVITE_EMAILS_QUEUE }),
    UsersModule,
    AssessmentsModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService, InviteEmailsProcessor],
  exports: [InvitationsService],
})
export class InvitationsModule {}
