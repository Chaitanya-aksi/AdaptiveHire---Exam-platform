import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

/**
 * What `sendMail` actually returns here: SMTP's envelope info (which
 * `getTestMessageUrl` reads) plus the serialised body that `jsonTransport`
 * substitutes when there is no SMTP at all.
 */
type SentMessageInfo = SMTPTransport.SentMessageInfo & {
  message?: string | Buffer;
};

export interface InviteEmailParams {
  to: string;
  /** May be empty — the greeting falls back to a neutral line. */
  candidateName: string;
  assessmentTitle: string;
  /** Link to the register page, pre-filled with the invited email. */
  registerUrl: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;
  private readonly smtpHost: string;
  /** True when no real SMTP is configured — dev mode via an Ethereal inbox. */
  private readonly devMode: boolean;
  /** Built lazily and once: Ethereal setup is async and hits the network. */
  private transporterPromise: Promise<nodemailer.Transporter> | null = null;

  constructor(private readonly config: ConfigService) {
    this.from = this.config.getOrThrow<string>('mail.from');
    this.smtpHost = this.config.get<string>('mail.host') ?? '';
    this.devMode = !this.smtpHost;
  }

  async sendInvite(params: InviteEmailParams): Promise<void> {
    const { subject, text, html } = buildInviteEmail(params);
    const transporter = await this.transporter();

    // `Transporter.sendMail` is typed as returning `any`, so pin it to the
    // shape actually used below rather than letting `any` leak downstream.
    const info = (await transporter.sendMail({
      from: this.from,
      to: params.to,
      subject,
      text,
      html,
    })) as unknown as SentMessageInfo;

    if (!this.devMode) return;

    // Ethereal returns a viewable preview URL; jsonTransport (offline
    // fallback) returns the serialised message instead.
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      this.logger.log(
        `[DEV EMAIL] invite for ${params.to} — preview: ${previewUrl}`,
      );
    } else {
      this.logger.log(
        `[DEV EMAIL] invite for ${params.to}\n${String(info.message ?? '')}`,
      );
    }
  }

  private transporter(): Promise<nodemailer.Transporter> {
    this.transporterPromise ??= this.createTransporter();
    return this.transporterPromise;
  }

  private async createTransporter(): Promise<nodemailer.Transporter> {
    if (this.smtpHost) {
      const user = this.config.get<string>('mail.user') ?? '';
      const pass = this.config.get<string>('mail.pass') ?? '';
      this.logger.log(`SMTP transport ready (${this.smtpHost})`);
      return nodemailer.createTransport({
        host: this.smtpHost,
        port: this.config.get<number>('mail.port'),
        secure: this.config.get<boolean>('mail.secure') ?? false,
        auth: user || pass ? { user, pass } : undefined,
      });
    }

    // No SMTP configured: use a throwaway Ethereal test inbox so every invite
    // gets a viewable preview URL without a real account. Nothing reaches a
    // real inbox. If Ethereal can't be reached (offline), fall back to logging
    // the serialised message so the flow still works.
    try {
      const account = await nodemailer.createTestAccount();
      this.logger.warn(
        'MAIL_HOST is not set — using an Ethereal test inbox (emails are NOT ' +
          'delivered to real inboxes). Browse every invite at ' +
          `https://ethereal.email/login with user "${account.user}" / ` +
          `pass "${account.pass}", or open the per-message preview URL logged ` +
          'for each send.',
      );
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: account.user, pass: account.pass },
      });
    } catch (error) {
      this.logger.warn(
        `Could not reach Ethereal (${
          error instanceof Error ? error.message : String(error)
        }); invite emails will be logged to the console instead.`,
      );
      return nodemailer.createTransport({ jsonTransport: true });
    }
  }
}

/** Plain-text and HTML bodies for an assessment invitation. */
function buildInviteEmail(params: InviteEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { candidateName, assessmentTitle, registerUrl, to } = params;
  const greeting = candidateName ? `Hi ${candidateName},` : 'Hi there,';
  const subject = `You've been invited to complete "${assessmentTitle}"`;

  const text = [
    greeting,
    '',
    `You've been invited to complete the assessment "${assessmentTitle}" on AdaptiveHire.`,
    '',
    'To get started:',
    `1. Open ${registerUrl}`,
    `2. Create your account using this email address (${to}) and choose your own password.`,
    '3. Sign in — the assessment will be waiting in your list.',
    '',
    'If you already have an AdaptiveHire account with this email, just sign in and it will appear in your assessments.',
    '',
    '— The AdaptiveHire team',
  ].join('\n');

  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1f2933; line-height: 1.5;">
    <p>${greeting}</p>
    <p>You've been invited to complete the assessment
       <strong>"${escapeHtml(assessmentTitle)}"</strong> on AdaptiveHire.</p>
    <p>To get started, create your account using this email address
       (<strong>${escapeHtml(to)}</strong>) and choose your own password:</p>
    <p>
      <a href="${escapeHtml(registerUrl)}"
         style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">
        Set up your account
      </a>
    </p>
    <p style="color:#52606d;font-size:13px;">
      Or paste this link into your browser:<br>
      <span>${escapeHtml(registerUrl)}</span>
    </p>
    <p style="color:#52606d;font-size:13px;">
      Already have an AdaptiveHire account with this email? Just sign in and the
      assessment will be in your list.
    </p>
    <p>— The AdaptiveHire team</p>
  </div>`;

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
