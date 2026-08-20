/**
 * Shared name + payloads for the transactional-email queue (producer and
 * worker).
 *
 * The queue name is historical — it carries password-reset mail too. It is left
 * as 'invite-emails' deliberately: renaming it would orphan any job already
 * sitting in Redis under the old key, and the name is not worth a lost email.
 */
export const INVITE_EMAILS_QUEUE = 'invite-emails';

/**
 * Two different emails go out, and which one depends on whether the invited
 * address already had an account.
 *
 * `credentials` carries a password we generated for a brand-new account.
 * `existing-account` carries none: that account belongs to a person who may
 * already be testing for another company, and minting them a fresh password
 * would hand this recruiter a way into someone else's results.
 */
export type InviteEmailKind = 'credentials' | 'existing-account';

export interface InviteEmailJob {
  kind: InviteEmailKind;
  to: string;
  candidateName: string;
  assessmentTitle: string;
  /** Where to sign in. Both kinds need it. */
  loginUrl: string;
  /**
   * Only ever set for `credentials`. Present in the Redis job payload until the
   * job is consumed, which is why the queue drops completed jobs immediately.
   */
  password?: string;
}

/**
 * A reset link for someone who cannot get in.
 *
 * The link carries a single-use token, so — exactly like `credentials` above —
 * this payload is a live secret while it waits in Redis, and the producer drops
 * the job on both success and failure so it never lingers.
 */
export interface PasswordResetEmailJob {
  kind: 'password-reset';
  to: string;
  /** May be empty; the greeting falls back to a neutral line. */
  fullName: string;
  /** Fully-formed link including the token. */
  resetUrl: string;
  /** So the email can say how long they have, without hardcoding it twice. */
  expiresInMinutes: number;
}

/**
 * Tells the person who owns a requisition that somebody finished it.
 *
 * Carries no score. The email is a nudge to go and look, and a result sitting
 * in an inbox is a result read without the standing, the proctoring context or
 * the answers beside it — which is the whole reason the report exists.
 */
export interface AttemptCompletedEmailJob {
  kind: 'attempt-completed';
  to: string;
  /** May be empty; the greeting falls back to a neutral line. */
  recruiterName: string;
  candidateName: string;
  assessmentTitle: string;
  /** Deep link to that candidate's report. */
  reportUrl: string;
}

/**
 * Tells a candidate they are not being taken forward.
 *
 * The only email in the product that a *person* is worse off for receiving, so
 * three things are deliberate about this payload:
 *
 *  - It carries the hiring company's name, not AdaptiveHire's. A candidate
 *    applied to a company, and a rejection signed by a platform they have never
 *    heard of is both confusing and cold.
 *  - It carries no score, no ranking and no reason. Those invite a reply
 *    arguing the result, and a rule-based band is not a defensible explanation
 *    of why one person was preferred over another.
 *  - There is no deep link. There is nothing for them to go and look at, and a
 *    button in a rejection reads as a prompt to re-engage with a process that
 *    has closed.
 */
export interface RejectionEmailJob {
  kind: 'rejection';
  to: string;
  /** May be empty; the greeting falls back to a neutral line. */
  candidateName: string;
  /** The company that assessed them — whose name this is sent under. */
  organisationName: string;
  assessmentTitle: string;
  /**
   * Where they may reply, if the company has published an address.
   *
   * Set as Reply-To rather than written into the body: a candidate who wants to
   * respond should be able to just hit reply, and a no-reply rejection is the
   * detail people remember most bitterly. Null when nothing is configured, in
   * which case no header is set rather than one pointing nowhere.
   */
  replyTo: string | null;
}

/**
 * A message a recruiter wrote to a candidate, in their own words.
 *
 * The way back to somebody already rejected. That decision is final in the
 * product — an email has been read, and no toggle un-reads it — so reopening a
 * conversation means actually writing to the person, which is what this is.
 *
 * Unlike every other email here, the substance is authored by a human at send
 * time. The template supplies only the greeting, the attribution and the
 * sign-off; `body` is passed through, escaped, exactly as typed.
 */
export interface CandidateMessageEmailJob {
  kind: 'candidate-message';
  to: string;
  /** May be empty; the greeting falls back to a neutral line. */
  candidateName: string;
  /** The company writing. This is sent under their name, not ours. */
  organisationName: string;
  assessmentTitle: string;
  /** What the recruiter typed. Never generated, never edited on the way out. */
  body: string;
  /** Their support address as Reply-To, so an answer reaches the sender. */
  replyTo: string | null;
}

/**
 * Everything this queue carries. Discriminated on `kind`, so the worker gets an
 * exhaustiveness check from the compiler rather than a runtime surprise when a
 * sixth kind is added.
 */
export type OutboundEmailJob =
  | InviteEmailJob
  | PasswordResetEmailJob
  | AttemptCompletedEmailJob
  | RejectionEmailJob
  | CandidateMessageEmailJob;
