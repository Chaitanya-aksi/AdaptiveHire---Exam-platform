import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from '../../mail/mail.service';
import { INVITE_EMAILS_QUEUE, type InviteEmailJob } from './invite-emails.job';

/**
 * Sends one invite email per job. Retries/backoff are configured by the
 * producer when it enqueues; a thrown error here lets BullMQ retry so a
 * transient SMTP hiccup doesn't silently drop an invitation.
 */
@Processor(INVITE_EMAILS_QUEUE)
export class InviteEmailsProcessor extends WorkerHost {
  private readonly logger = new Logger(InviteEmailsProcessor.name);

  constructor(private readonly mail: MailService) {
    super();
  }

  async process(job: Job<InviteEmailJob>): Promise<void> {
    const { to, candidateName, assessmentTitle, registerUrl } = job.data;
    await this.mail.sendInvite({
      to,
      candidateName,
      assessmentTitle,
      registerUrl,
    });
    this.logger.log(`Invite email handled for ${to} (job ${job.id})`);
  }
}
