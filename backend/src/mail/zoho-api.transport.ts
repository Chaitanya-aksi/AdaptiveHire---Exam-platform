import { Logger } from '@nestjs/common';
import type MailMessage from 'nodemailer/lib/mailer/mail-message';

/**
 * Sends through the Zoho Mail REST API instead of SMTP.
 *
 * **Why this exists.** Render blocks outbound traffic to SMTP ports 25, 465 and
 * 587 on free web services. The connection never opens, so every send hung for
 * ~90s and then failed — and because invite jobs carry a plaintext password they
 * are queued `removeOnFail: true`, so each failure deleted its own evidence. The
 * result was a month of invitations that silently never arrived while the UI
 * reported success. This API speaks HTTPS on 443, which is not blocked.
 *
 * **Why Zoho's own API rather than a third-party relay.** The mail genuinely
 * originates from the mailbox that already exists, so it inherits the
 * authentication already published for the domain: SPF already includes
 * `zohomail.in` and DKIM is already live at `zmail._domainkey`. A relay would
 * have needed either DNS records nobody could reach, a phone number, or a card.
 *
 * **It is a nodemailer transport on purpose.** Implementing nodemailer's tiny
 * `send` contract means `MailService.send`, every template, the queue and the
 * processor are untouched — the only difference is which object
 * `createTransport` was handed. Swapping back to SMTP is one environment
 * variable, and nothing downstream can tell the difference.
 */

/** How early to refresh, so a token cannot expire mid-flight. */
const REFRESH_SKEW_MS = 60_000;

/** Zoho issues access tokens for an hour; used only if it omits `expires_in`. */
const ASSUMED_TOKEN_LIFETIME_MS = 3_600_000;

export interface ZohoApiConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountId: string;
  /** Data-centre suffix: `in`, `com`, `eu`, `au`, `jp`. */
  region: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface ZohoSendResponse {
  status?: { code?: number; description?: string };
  data?: { messageId?: string };
}

export class ZohoApiTransport {
  /** nodemailer reads both of these off the transport object. */
  readonly name = 'zoho-api';
  readonly version = '1.0.0';

  private readonly logger = new Logger(ZohoApiTransport.name);
  private accessToken: string | null = null;
  private expiresAt = 0;
  /**
   * The in-flight refresh, so concurrent sends share one token request.
   *
   * The queue processes several emails at once. Without this, each would
   * independently POST to the token endpoint on a cold start, which is both
   * wasteful and a good way to meet Zoho's rate limiter during a burst of
   * invitations.
   */
  private refreshing: Promise<string> | null = null;
  /** Logged once, not per message — see `send`. */
  private warnedAboutReplyTo = false;

  constructor(private readonly config: ZohoApiConfig) {}

  private get accountsHost(): string {
    return `https://accounts.zoho.${this.config.region}`;
  }

  private get mailHost(): string {
    return `https://mail.zoho.${this.config.region}`;
  }

  /**
   * A valid access token, refreshed when it is close to expiry.
   *
   * `force` bypasses the cache after a 401, which is how a token revoked or
   * invalidated early is recovered from without waiting for the clock.
   */
  private async token(force = false): Promise<string> {
    if (!force && this.accessToken && Date.now() < this.expiresAt) {
      return this.accessToken;
    }
    // Collapse concurrent refreshes onto one request.
    this.refreshing ??= this.refreshToken().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshToken(): Promise<string> {
    const body = new URLSearchParams({
      refresh_token: this.config.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
    });

    const response = await fetch(`${this.accountsHost}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const payload = (await response.json().catch(() => ({}))) as TokenResponse;

    /*
     * Zoho answers HTTP 200 with an `error` field for a bad grant, so the
     * status code alone is not the verdict. Checking only `response.ok` here
     * would cache `undefined` as the token and turn a credential problem into a
     * confusing 401 on the next send instead of a clear failure now.
     */
    if (!response.ok || payload.error || !payload.access_token) {
      throw new Error(
        `Zoho token refresh failed (HTTP ${response.status}): ` +
          `${payload.error ?? 'no access_token in response'}. ` +
          'Check MAIL_ZOHO_CLIENT_ID, MAIL_ZOHO_CLIENT_SECRET, ' +
          'MAIL_ZOHO_REFRESH_TOKEN and MAIL_ZOHO_REGION.',
      );
    }

    const lifetime = (payload.expires_in ?? 0) * 1000 || ASSUMED_TOKEN_LIFETIME_MS;
    this.accessToken = payload.access_token;
    this.expiresAt = Date.now() + lifetime - REFRESH_SKEW_MS;
    return this.accessToken;
  }

  /**
   * nodemailer's transport contract: take a built message, deliver it, call
   * back. Callback rather than a promise because that is the interface
   * nodemailer defines, and a throw here would not reach the caller.
   */
  send(
    mail: MailMessage,
    callback: (error: Error | null, info?: unknown) => void,
  ): void {
    this.deliver(mail).then(
      (info) => callback(null, info),
      (error: unknown) =>
        callback(error instanceof Error ? error : new Error(String(error))),
    );
  }

  private async deliver(mail: MailMessage): Promise<{
    messageId: string;
    envelope: { from: string; to: string[] };
    accepted: string[];
    rejected: string[];
    response: string;
  }> {
    const data = mail.data;
    const to = addressList(data.to);
    if (to.length === 0) throw new Error('No recipients defined');

    /*
     * Zoho's send API has no Reply-To field — `fromAddress`, `toAddress`,
     * `ccAddress`, `bccAddress`, `subject`, `content` and `mailFormat` are the
     * whole envelope. Rejection and candidate-message emails set one so a reply
     * reaches the hiring company rather than the platform, and that is a real
     * loss worth stating rather than hiding.
     *
     * It is not silent in practice: mail sent this way comes from the Zoho
     * mailbox in `MAIL_FROM`, which is a real monitored inbox, so a reply lands
     * there instead of at the configured support address. Warned once per
     * process rather than per message, because a burst of rejections would
     * otherwise fill the log with the same line.
     */
    if (data.replyTo && !this.warnedAboutReplyTo) {
      this.warnedAboutReplyTo = true;
      this.logger.warn(
        'The Zoho Mail API cannot set Reply-To, so replies will go to ' +
          `${addressList(data.from)[0] ?? 'the sending mailbox'} rather than ` +
          'the address the caller asked for. Switch MAIL_TRANSPORT back to ' +
          'smtp if Reply-To matters more than delivery.',
      );
    }

    const html = asText(data.html);
    const text = asText(data.text);

    const body = {
      // Passed through as nodemailer formatted it, so a display name like
      // "AdaptiveHire <ds09.user@…>" survives. Zoho accepts that form.
      fromAddress: addressList(data.from)[0] ?? '',
      toAddress: to.join(','),
      subject: data.subject ?? '',
      content: html || text,
      mailFormat: html ? 'html' : 'plaintext',
      askReceipt: 'no',
      ...(addressList(data.cc).length
        ? { ccAddress: addressList(data.cc).join(',') }
        : {}),
      ...(addressList(data.bcc).length
        ? { bccAddress: addressList(data.bcc).join(',') }
        : {}),
    };

    let response = await this.post(body, await this.token());

    // One retry on 401 with a forced refresh: a token can be invalidated before
    // its stated expiry, and re-sending is safe because Zoho rejected this one.
    if (response.status === 401) {
      response = await this.post(body, await this.token(true));
    }

    const payload = (await response
      .json()
      .catch(() => ({}))) as ZohoSendResponse;

    // Same shape of trap as the token endpoint: Zoho can answer HTTP 200 while
    // `status.code` reports a failure, so both are checked.
    const code = payload.status?.code;
    if (!response.ok || (code !== undefined && code !== 200)) {
      throw new Error(
        `Zoho send failed (HTTP ${response.status}` +
          `${code !== undefined ? `, status ${code}` : ''}): ` +
          `${payload.status?.description ?? 'no description'}`,
      );
    }

    const messageId = payload.data?.messageId ?? `zoho-${Date.now()}`;
    return {
      messageId,
      envelope: { from: body.fromAddress, to },
      accepted: to,
      rejected: [],
      response: `250 Sent via Zoho Mail API (${messageId})`,
    };
  }

  private post(body: unknown, token: string): Promise<Response> {
    return fetch(
      `${this.mailHost}/api/accounts/${this.config.accountId}/messages`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Zoho-oauthtoken ${token}`,
        },
        body: JSON.stringify(body),
      },
    );
  }
}

/**
 * nodemailer address fields are a string, an object, or a mixed array of both.
 * Flattened here to the plain strings Zoho wants, rather than at each call.
 */
export function addressList(value: unknown): string[] {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];

  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const { name, address } = item as { name?: string; address?: string };
        if (!address) return '';
        return name ? `${name} <${address}>` : address;
      }
      return '';
    })
    .filter(Boolean);
}

/** Bodies arrive as a string here; Buffers and streams are not used. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}
