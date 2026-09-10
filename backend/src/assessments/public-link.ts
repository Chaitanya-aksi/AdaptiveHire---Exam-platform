import { createHash, randomBytes } from 'node:crypto';

/**
 * The rules a public assessment link is governed by, in one file.
 *
 * Pure on purpose, like `assessment-window.ts` and `candidate-branding.ts`: the
 * recruiter's management screen, the candidate's entry page and the endpoint
 * that actually admits somebody all have to agree about whether a link is open.
 * A candidate shown a Start button that the server then refuses is the exact
 * failure that kind of duplication produces.
 *
 * See `docs/public-assessment-links.md` for why this exists at all, and for
 * what it deliberately gives up — chiefly that with an open link the email is
 * self-asserted, so a self-registered attempt is weaker evidence about a person
 * than an invited one.
 */

/**
 * 32 bytes of randomness, base64url encoded.
 *
 * Well past the 128 bits the proposal called for. The token is guessable-once
 * or not at all: there is no rate at which brute force is worth attempting
 * against 256 bits, which is what lets this be the only thing standing between
 * the internet and an attempt.
 */
const TOKEN_BYTES = 32;

/** What the link's state is, and therefore what the candidate is shown. */
export type PublicLinkState =
  | 'open'
  /** Never configured. The recruiter has not created a link at all. */
  | 'not_configured'
  /** Configured, then switched off. Reversible without reissuing. */
  | 'disabled'
  /** Past its own expiry, or past the assessment's `closesAt`. */
  | 'expired'
  /** Not open yet, because the assessment's window has not started. */
  | 'not_yet'
  /** The attempt cap has been reached. */
  | 'full';

/** Only the fields the rules read, so callers need not pass a whole entity. */
export interface PublicLinkConfig {
  publicLinkTokenHash: string | null;
  publicLinkEnabled: boolean;
  publicLinkExpiresAt: Date | null;
  publicLinkMaxAttempts: number | null;
  publicLinkEmailDomain: string | null;
  /** The assessment's own window, which bounds the link regardless. */
  opensAt: Date | null;
  closesAt: Date | null;
}

export interface GeneratedToken {
  /** Shown to the recruiter once and never stored. */
  token: string;
  /** What goes in the database. */
  hash: string;
}

/**
 * Mints a link token and the hash to store against it.
 *
 * The raw token is returned to exactly one caller and never persisted, which is
 * why regenerating is the only way to recover a lost one. That is the same
 * bargain `password_reset_tokens` makes, and for the same reason: a credential
 * kept in the database is a credential in every backup.
 */
export function generatePublicLinkToken(): GeneratedToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashPublicLinkToken(token) };
}

/**
 * SHA-256, hex.
 *
 * Deliberately not argon2, unlike a password. This value has 256 bits of
 * entropy and no human chose it, so there is no dictionary to slow down and
 * nothing to be gained from a work factor — while a lookup happens on every
 * page load of the entry screen, where argon2 would be a denial-of-service
 * surface rather than a defence.
 */
export function hashPublicLinkToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Whether the link admits anyone right now, and if not, why.
 *
 * Order matters and is not arbitrary: a candidate arriving at a link that was
 * switched off should be told it is closed, not that it never existed. The
 * least informative answer is reserved for the case where there genuinely is
 * nothing there.
 */
export function publicLinkState(
  config: PublicLinkConfig,
  attemptCount: number,
  now: Date = new Date(),
): PublicLinkState {
  if (!config.publicLinkTokenHash) return 'not_configured';
  if (!config.publicLinkEnabled) return 'disabled';

  // The assessment's own window bounds the link whatever the link says. A
  // recruiter who closes a round should not have to remember to close the link
  // separately, and a link that outlived its assessment would admit somebody to
  // a test the runtime would then refuse to start.
  if (config.opensAt && now < config.opensAt) return 'not_yet';
  if (config.closesAt && now >= config.closesAt) return 'expired';

  if (config.publicLinkExpiresAt && now >= config.publicLinkExpiresAt) {
    return 'expired';
  }

  // `>=` rather than `>`: the cap is how many attempts the link may create, so
  // reaching it closes the door rather than allowing one more through.
  if (
    config.publicLinkMaxAttempts !== null &&
    attemptCount >= config.publicLinkMaxAttempts
  ) {
    return 'full';
  }

  return 'open';
}

/**
 * Whether this address may use the link, given an optional domain restriction.
 *
 * The single most effective narrowing available once there is no invited list —
 * a campus drive restricted to one college's domain is very nearly as tight as
 * a list, without anybody having to collect the addresses first.
 *
 * Compared case-insensitively on the part after the last `@`, because an
 * address may legitimately contain one earlier in a quoted local part.
 */
export function emailAllowedByDomain(
  email: string,
  domain: string | null,
): boolean {
  if (!domain) return true;

  const at = email.lastIndexOf('@');
  if (at === -1) return false;

  const candidateDomain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  // A leading @ is accepted in the stored value, since that is how people
  // naturally write a domain restriction.
  const required = domain.trim().toLowerCase().replace(/^@/, '');

  return candidateDomain === required;
}

/** What a candidate is told, per state. Never mentions why beyond the fact. */
export const PUBLIC_LINK_MESSAGE: Record<
  Exclude<PublicLinkState, 'open'>,
  string
> = {
  not_configured: 'This link is not valid.',
  disabled: 'This assessment is no longer accepting new candidates.',
  expired: 'This assessment has closed.',
  not_yet: 'This assessment has not opened yet.',
  full: 'This assessment is no longer accepting new candidates.',
};
