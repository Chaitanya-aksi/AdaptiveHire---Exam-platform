import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from '../../mail/mail.service';
import {
  INVITE_EMAILS_QUEUE,
  type OutboundEmailJob,
} from './invite-emails.job';

/**
 * Sends one transactional email per job. Retries/backoff are configured by the
 * producer when it enqueues; a thrown error here lets BullMQ retry so a
 * transient SMTP hiccup doesn't silently drop an invitation or a reset link.
 */
@Processor(INVITE_EMAILS_QUEUE)
export class InviteEmailsProcessor extends WorkerHost {
  private readonly logger = new Logger(InviteEmailsProcessor.name);

  constructor(private readonly mail: MailService) {
    super();
  }

  async process(job: Job<OutboundEmailJob>): Promise<void> {
    const data = job.data;

    switch (data.kind) {
      case 'credentials':
      case 'existing-account': {
        await this.mail.sendInvite({
          to: data.to,
          candidateName: data.candidateName,
          assessmentTitle: data.assessmentTitle,
          loginUrl: data.loginUrl,
          password: data.password,
        });
        break;
      }

      case 'password-reset': {
        await this.mail.sendPasswordReset({
          to: data.to,
          fullName: data.fullName,
          resetUrl: data.resetUrl,
          expiresInMinutes: data.expiresInMinutes,
        });
        break;
      }

      case 'attempt-completed': {
        await this.mail.sendAttemptCompleted({
          to: data.to,
          recruiterName: data.recruiterName,
          candidateName: data.candidateName,
          assessmentTitle: data.assessmentTitle,
          reportUrl: data.reportUrl,
        });
        break;
      }

      case 'rejection': {
        await this.mail.sendRejection({
          to: data.to,
          candidateName: data.candidateName,
          organisationName: data.organisationName,
          assessmentTitle: data.assessmentTitle,
          replyTo: data.replyTo,
        });
        break;
      }

      case 'candidate-message': {
        await this.mail.sendCandidateMessage({
          to: data.to,
          candidateName: data.candidateName,
          organisationName: data.organisationName,
          assessmentTitle: data.assessmentTitle,
          body: data.body,
          replyTo: data.replyTo,
        });
        break;
      }

      default: {
        // Never reached while the union is handled exhaustively; if a new kind
        // is added without a branch, this line stops compiling.
        const unhandled: never = data;
        throw new Error(
          `Unhandled email job: ${JSON.stringify(unhandled).slice(0, 120)}`,
        );
      }
    }

    // The kind and the recipient, never the password or the reset token: this
    // line goes to the application log, which is not a place for either.
    this.logger.log(
      `Email (${data.kind}) handled for ${data.to} (job ${job.id})`,
    );
  }
}
