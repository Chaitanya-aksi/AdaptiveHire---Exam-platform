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
  /** Where to sign in. */
  loginUrl: string;
  /**
   * The generated password, for a brand-new account only.
   *
   * Absent when the address already had an account: that account may already be
   * sitting another company's assessments, so it keeps the password its owner
   * chose and this email simply tells them to sign in.
   */
  password?: string;
}

export interface AttemptCompletedEmailParams {
  to: string;
  /** May be empty — the greeting falls back to a neutral line. */
  recruiterName: string;
  candidateName: string;
  assessmentTitle: string;
  reportUrl: string;
}

export interface PasswordResetEmailParams {
  to: string;
  /** May be empty — the greeting falls back to a neutral line. */
  fullName: string;
  /** Fully-formed link including the single-use token. */
  resetUrl: string;
  expiresInMinutes: number;
}

export interface RejectionEmailParams {
  to: string;
  /** May be empty — the greeting falls back to a neutral line. */
  candidateName: string;
  /** The hiring company. This email is sent under their name, not ours. */
  organisationName: string;
  assessmentTitle: string;
  /** Their support address, set as Reply-To. Null when none is configured. */
  replyTo: string | null;
}

export interface CandidateMessageEmailParams {
  to: string;
  /** May be empty — the greeting falls back to a neutral line. */
  candidateName: string;
  organisationName: string;
  assessmentTitle: string;
  /** The recruiter's own words. Passed through, never rewritten. */
  body: string;
  replyTo: string | null;
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
    await this.send('invite', params.to, buildInviteEmail(params));
  }

  /**
   * The way back in for someone who cannot sign in.
   *
   * The link is the secret, so in dev the preview URL is logged and the body is
   * not — a reset link in a shared terminal log is a live account takeover for
   * as long as the token lasts.
   */
  async sendPasswordReset(params: PasswordResetEmailParams): Promise<void> {
    await this.send(
      'password reset',
      params.to,
      buildPasswordResetEmail(params),
      { logBody: false },
    );
  }

  /**
   * Tells a candidate they are not being taken forward.
   *
   * Reply-To is the company's own address where they have one, so a reply
   * reaches the people who made the decision rather than the platform.
   */
  async sendRejection(params: RejectionEmailParams): Promise<void> {
    await this.send('rejection', params.to, buildRejectionEmail(params), {
      replyTo: params.replyTo,
    });
  }

  /**
   * A message a recruiter wrote to a candidate, in their own words.
   *
   * The escape hatch after a rejection: the decision is final, so getting back
   * in touch means actually writing to the person.
   */
  async sendCandidateMessage(
    params: CandidateMessageEmailParams,
  ): Promise<void> {
    await this.send(
      'candidate message',
      params.to,
      buildCandidateMessageEmail(params),
      { replyTo: params.replyTo },
    );
  }

  /** Tells whoever owns a requisition that a candidate has finished it. */
  async sendAttemptCompleted(
    params: AttemptCompletedEmailParams,
  ): Promise<void> {
    await this.send(
      'attempt completed',
      params.to,
      buildAttemptCompletedEmail(params),
    );
  }

  /**
   * One send path for every transactional email: same transport, same dev-mode
   * logging, so a new email cannot accidentally arrive with different handling.
   */
  private async send(
    label: string,
    to: string,
    body: { subject: string; text: string; html: string },
    options: { logBody?: boolean; replyTo?: string | null } = {},
  ): Promise<void> {
    const transporter = await this.transporter();

    // `Transporter.sendMail` is typed as returning `any`, so pin it to the
    // shape actually used below rather than letting `any` leak downstream.
    const info = (await transporter.sendMail({
      from: this.from,
      to,
      // Omitted entirely when null rather than sent empty: a blank Reply-To is
      // treated inconsistently by clients, and some show it as a dead address.
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      subject: body.subject,
      text: body.text,
      html: body.html,
    })) as unknown as SentMessageInfo;

    if (!this.devMode) return;

    // Ethereal returns a viewable preview URL; jsonTransport (offline
    // fallback) returns the serialised message instead.
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      this.logger.log(
        `[DEV EMAIL] ${label} for ${to} — preview: ${previewUrl}`,
      );
    } else if (options.logBody === false) {
      this.logger.log(
        `[DEV EMAIL] ${label} for ${to} — body withheld from the log because ` +
          'it contains a single-use link. Configure MAIL_HOST to receive it.',
      );
    } else {
      this.logger.log(
        `[DEV EMAIL] ${label} for ${to}\n${String(info.message ?? '')}`,
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

/**
 * Plain-text and HTML bodies for an assessment invitation.
 *
 * Two shapes, chosen by whether a password was generated. Both land the reader
 * on the sign-in page — the difference is whether we are handing them a way in
 * or reminding them they already have one.
 */
function buildInviteEmail(params: InviteEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { candidateName, assessmentTitle, loginUrl, password, to } = params;
  const greeting = candidateName ? `Hi ${candidateName},` : 'Hi there,';
  const subject = `You've been invited to complete "${assessmentTitle}"`;

  const intro = `You've been invited to complete the assessment "${assessmentTitle}" on AdaptiveHire.`;

  const text = password
    ? [
        greeting,
        '',
        intro,
        '',
        'An account has been created for you. Sign in with:',
        `  Email:    ${to}`,
        `  Password: ${password}`,
        '',
        `Sign in here: ${loginUrl}`,
        '',
        "You'll be asked to choose your own password the first time you sign in,",
        'after which the one above stops working.',
        '',
        '— The AdaptiveHire team',
      ].join('\n')
    : [
        greeting,
        '',
        intro,
        '',
        `You already have an AdaptiveHire account for ${to}, so sign in with your`,
        'existing password and the assessment will be waiting in your list.',
        '',
        `Sign in here: ${loginUrl}`,
        '',
        '— The AdaptiveHire team',
      ].join('\n');

  const credentialsBlock = password
    ? `
    <p>An account has been created for you. Sign in with:</p>
    <table style="border-collapse:collapse;background:#f5f7fa;border-radius:8px;margin:0 0 4px;">
      <tr>
        <td style="padding:10px 14px;color:#52606d;font-size:13px;">Email</td>
        <td style="padding:10px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
          <strong>${escapeHtml(to)}</strong></td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:#52606d;font-size:13px;border-top:1px solid #e2e5ea;">Password</td>
        <td style="padding:10px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;border-top:1px solid #e2e5ea;">
          <strong>${escapeHtml(password)}</strong></td>
      </tr>
    </table>
    <p style="color:#52606d;font-size:13px;">
      You'll be asked to choose your own password the first time you sign in,
      after which the one above stops working.
    </p>`
    : `
    <p>You already have an AdaptiveHire account for
       <strong>${escapeHtml(to)}</strong>. Sign in with your existing password and
       the assessment will be waiting in your list.</p>`;

  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1f2933; line-height: 1.5;">
    <p>${greeting}</p>
    <p>You've been invited to complete the assessment
       <strong>"${escapeHtml(assessmentTitle)}"</strong> on AdaptiveHire.</p>
    ${credentialsBlock}
    <p>
      <a href="${escapeHtml(loginUrl)}"
         style="display:inline-block;background:#2f5bea;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">
        Sign in and start
      </a>
    </p>
    <p style="color:#52606d;font-size:13px;">
      Or paste this link into your browser:<br>
      <span>${escapeHtml(loginUrl)}</span>
    </p>
    <p>— The AdaptiveHire team</p>
  </div>`;

  return { subject, text, html };
}

/**
 * The rejection email.
 *
 * Built to the same shape as the others — plain text first, HTML alongside —
 * but written to a different standard, because it is the only email here that
 * makes its reader's day worse. The rules it follows:
 *
 *  - **Say it in the first sentence.** Burying the decision under two
 *    paragraphs of warmth makes the reader hunt for it, and reading a rejection
 *    twice is worse than reading it once.
 *  - **Name the company and the role.** Someone job-hunting has applications
 *    open everywhere; an unattributed rejection is unkind and useless.
 *  - **Give no reason and no score.** A rule-based band is not a defensible
 *    account of why another candidate was preferred, and offering one invites
 *    an argument the recruiter cannot win and did not agree to have.
 *  - **Do not say "we will keep your CV on file"** unless it is true. It is the
 *    line every rejection contains and almost none mean.
 *  - **No link, no button, no next step.** There is nothing to do.
 *
 * Signed by the company, not by AdaptiveHire: the candidate applied to them.
 */
function buildRejectionEmail(params: RejectionEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { candidateName, organisationName, assessmentTitle } = params;
  const greeting = candidateName ? `Hi ${candidateName},` : 'Hi there,';

  // Neutral on purpose. A subject line that announces the outcome turns an
  // inbox preview into the rejection itself, in front of whoever is nearby.
  const subject = `Your application to ${organisationName}`;

  const lines = [
    greeting,
    '',
    `Thank you for taking the time to complete "${assessmentTitle}" for ` +
      `${organisationName}.`,
    '',
    'After careful consideration, we have decided not to take your application',
    'further on this occasion. We know that is disappointing to read, and we do',
    'not take lightly the time and effort you put into the assessment.',
    '',
    'This decision reflects the particular requirements of this role and the',
    'strength of the field, and it is not a judgement on your ability more',
    'broadly. We would genuinely welcome an application from you for a future',
    'opening that fits your experience.',
    '',
    'We wish you every success in your search.',
    '',
    `— ${organisationName}`,
  ];

  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1f2933; line-height: 1.6;">
    <p>${escapeHtml(greeting)}</p>
    <p>Thank you for taking the time to complete
       <strong>"${escapeHtml(assessmentTitle)}"</strong> for
       ${escapeHtml(organisationName)}.</p>
    <p>After careful consideration, we have decided not to take your
       application further on this occasion. We know that is disappointing to
       read, and we do not take lightly the time and effort you put into the
       assessment.</p>
    <p>This decision reflects the particular requirements of this role and the
       strength of the field, and it is not a judgement on your ability more
       broadly. We would genuinely welcome an application from you for a future
       opening that fits your experience.</p>
    <p>We wish you a very great success ahead.</p>
    <p>— ${escapeHtml(organisationName)}</p>
  </div>`;

  return { subject, text: lines.join('\n'), html };
}

/**
 * A recruiter's own message to a candidate.
 *
 * The only email here whose substance a person writes at send time, so the
 * template's job is the opposite of the others': supply the envelope — greeting,
 * attribution, sign-off — and otherwise stay out of the way.
 *
 * Two things it does *not* do. It does not reference the earlier rejection: the
 * recruiter knows what they are following up on and will say so, and a
 * machine-written "further to our previous decision" preamble would flatten
 * whatever they actually meant. And it does not reformat the body — line breaks
 * are preserved and nothing else is interpreted, so what the candidate reads is
 * what the recruiter typed.
 */
function buildCandidateMessageEmail(params: CandidateMessageEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { candidateName, organisationName, assessmentTitle, body } = params;
  const greeting = candidateName ? `Hi ${candidateName},` : 'Hi there,';

  // Names the company and the role so it is recognisable in an inbox that may
  // hold applications to a dozen places.
  const subject = `${organisationName} — about your application`;

  const text = [
    greeting,
    '',
    body.trim(),
    '',
    `— ${organisationName}`,
    `Regarding: ${assessmentTitle}`,
  ].join('\n');

  // Paragraph breaks preserved. Escaped first, so a recruiter typing an
  // ampersand or an angle bracket cannot break the markup — and so that
  // nothing pasted into the box can inject anything into the message.
  const paragraphs = escapeHtml(body.trim())
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('\n    ');

  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1f2933; line-height: 1.6;">
    <p>${escapeHtml(greeting)}</p>
    ${paragraphs}
    <p>— ${escapeHtml(organisationName)}</p>
    <p style="color:#52606d;font-size:13px;">
      Regarding: ${escapeHtml(assessmentTitle)}
    </p>
  </div>`;

  return { subject, text, html };
}

/**
 * The reset email.
 *
 * Two things it deliberately does *not* do: name the account's role or say
 * anything about what the account contains, and imply that a reset was
 * definitely requested by the recipient. Anyone can type an address into the
 * forgot-password form, so this lands in inboxes belonging to people who did
 * nothing — for them the only correct instruction is to ignore it.
 */
function buildPasswordResetEmail(params: PasswordResetEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { fullName, resetUrl, expiresInMinutes } = params;
  const greeting = fullName ? `Hi ${fullName},` : 'Hi there,';
  const subject = 'Reset your AdaptiveHire password';
  const validFor = `This link works once and expires in ${expiresInMinutes} minutes.`;

  const text = [
    greeting,
    '',
    'Click below to reset your password.',
    '',
    `Choose a new password here: ${resetUrl}`,
    '',
    validFor,
    '',
    "If it wasn't you, you can ignore this email — your password stays as it is",
    'and nobody can use this link without opening it from your inbox.',
    '',
    '— The AdaptiveHire team',
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
                font-size: 15px; line-height: 1.6; color: #16191d;">
      <p>${escapeHtml(greeting)}</p>
      <p>Click below to reset your password.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(resetUrl)}"
           style="display: inline-block; padding: 11px 20px; border-radius: 8px;
                  background: #2f5bea; color: #ffffff; font-weight: 600;
                  text-decoration: none;">Choose a new password</a>
      </p>
      <p style="color: #646b76; font-size: 13px;">${escapeHtml(validFor)}</p>
      <p style="color: #646b76; font-size: 13px;">
        If it wasn't you, you can ignore this email — your password stays as it
        is, and nobody can use this link without opening it from your inbox.
      </p>
      <p style="color: #646b76; font-size: 13px;">
        If the button doesn't work, paste this into your browser:<br>
        <span>${escapeHtml(resetUrl)}</span>
      </p>
      <p>— The AdaptiveHire team</p>
    </div>
  `;

  return { subject, text, html };
}

/**
 * The "somebody finished" email.
 *
 * Deliberately carries no score and no recommendation. A result read in an
 * inbox is a result read without the cohort it sits in, the proctoring
 * context, or the answers behind it — and those are exactly what stops a
 * number becoming a decision on its own. The email's whole job is to
 * say "there is something to look at" and link to where it can be looked at
 * properly.
 */
function buildAttemptCompletedEmail(params: AttemptCompletedEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { recruiterName, candidateName, assessmentTitle, reportUrl } = params;
  const greeting = recruiterName ? `Hi ${recruiterName},` : 'Hi there,';
  const subject = `${candidateName} completed "${assessmentTitle}"`;

  const text = [
    greeting,
    '',
    `${candidateName} has finished the assessment "${assessmentTitle}".`,
    '',
    `Their report is ready: ${reportUrl}`,
    '',
    '— AdaptiveHire',
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
                font-size: 15px; line-height: 1.6; color: #16191d;">
      <p>${escapeHtml(greeting)}</p>
      <p>
        <strong>${escapeHtml(candidateName)}</strong> has finished the
        assessment <strong>"${escapeHtml(assessmentTitle)}"</strong>.
      </p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(reportUrl)}"
           style="display: inline-block; padding: 11px 20px; border-radius: 8px;
                  background: #2f5bea; color: #ffffff; font-weight: 600;
                  text-decoration: none;">Open the report</a>
      </p>
      <p style="color: #646b76; font-size: 13px;">
        If the button doesn't work, paste this into your browser:<br>
        <span>${escapeHtml(reportUrl)}</span>
      </p>
      <p>— AdaptiveHire</p>
    </div>
  `;

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
