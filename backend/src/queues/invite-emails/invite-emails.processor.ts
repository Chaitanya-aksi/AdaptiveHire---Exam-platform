import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
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

  /**
   * Says out loud that an email did not go out.
   *
   * Without this the most important failures were the quietest ones. The jobs
   * carrying a secret — a reset link, a generated password — are enqueued with
   * `removeOnFail: true` so the payload is not left sitting in Redis after the
   * attempts run out, and that is right; but it also deleted the only evidence
   * the send had ever been tried. A blocked SMTP account therefore looked
   * identical to a working one from the server's side: the API answered 204, the
   * reset token was written, and nothing anywhere said the mail had bounced.
   *
   * So the failure is logged where the payload is not. The kind, the recipient
   * and the SMTP server's own words are what make the cause diagnosable —
   * "550 5.4.6 Unusual sending activity detected" names the problem outright —
   * and none of them are the secret. `job.data.resetUrl` and `job.data.password`
   * are deliberately never read here.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<OutboundEmailJob> | undefined, error: Error): void {
    const kind = job?.data?.kind ?? 'unknown';
    const to = job?.data?.to ?? 'unknown recipient';
    const attempts = job?.opts?.attempts ?? 1;
    const made = job?.attemptsMade ?? 0;
    // Only the last attempt is a delivery failure; the earlier ones are retries
    // that may still succeed, and logging those at error level would cry wolf.
    const final = made >= attempts;

    const message = `Email (${kind}) to ${to} failed on attempt ${made}/${attempts}: ${error.message}`;

    if (final) {
      this.logger.error(
        `${message} — GIVING UP, this email will not arrive. The recipient is ` +
          'waiting for mail that is not coming.',
      );
    } else {
      this.logger.warn(message);
    }
  }
}
