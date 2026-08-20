import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { INVITE_EMAILS_QUEUE } from './invite-emails.job';

/**
 * The transactional-email queue, registered exactly once.
 *
 * Three modules produce onto this queue — auth (password resets), invitations
 * (invites) and reports (completion notices). Each calling
 * `BullModule.registerQueue` for itself compiles and runs, and quietly creates
 * a *separate* `Queue` object per module: three Redis connections to the same
 * key, and three different objects behind one injection token.
 *
 * That is mostly invisible in production and lethal in tests — a spy attached
 * to one instance simply never sees the jobs another one enqueues, which reads
 * as "the feature is broken" rather than "you patched the wrong object". It
 * would also make any future per-queue concern (rate limits, metrics,
 * graceful drain) apply to one third of the traffic.
 *
 * So the registration lives here and everyone imports this instead.
 */
@Module({
  imports: [BullModule.registerQueue({ name: INVITE_EMAILS_QUEUE })],
  exports: [BullModule],
})
export class MailQueueModule {}
