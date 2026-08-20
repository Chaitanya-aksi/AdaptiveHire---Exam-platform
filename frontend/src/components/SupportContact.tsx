import type { Branding } from '../lib/types';

/*
 * Where a candidate turns when the assessment went wrong for them.
 *
 * This exists because the clock is server-authoritative and auto-submit fires
 * whether or not the browser is still open. That is the right design — it is
 * what stops a candidate stopping their own timer — but it means a power cut or
 * a dropped connection ends an attempt through no fault of the person sitting
 * it, and until now the product said nothing at all about what to do next.
 *
 * A `mailto:` rather than a ticket form: the decision is the inviting company's
 * to make, in their own inbox, against their own hiring process. A form would
 * mean building a queue, a state machine and a notification path to deliver a
 * message an email already delivers.
 *
 * Two rules for the copy here, both deliberate:
 *
 *  - Never promise an outcome. Whether an interrupted attempt is re-run is the
 *    recruiter's call, and a candidate told "you can reschedule" who is then
 *    refused has been misled by us rather than by them.
 *  - Never describe what the system could not detect. Telling a candidate which
 *    interruptions go unnoticed is a map of how to claim one that did not
 *    happen.
 */

/** Fields we prefill so the recruiter gets a usable message, not "help". */
interface SupportContactProps {
  organisation: Branding;
  /** Named in the subject line so the recruiter knows which round this is. */
  assessmentTitle: string;
  /**
   * The invitation id, quoted in the body.
   *
   * A recruiter can look one candidate's attempt up by it directly, which
   * matters when the same person has been invited to several rounds and the
   * assessment title alone does not identify which went wrong.
   */
  reference?: string;
  /** Softer wording for the page they land on after finishing normally. */
  tone?: 'inline' | 'card';
}

export function SupportContact({
  organisation,
  assessmentTitle,
  reference,
  tone = 'card',
}: SupportContactProps) {
  // Null means neither this company nor the platform has configured an address.
  // Render nothing at all rather than a placeholder: somebody who has just lost
  // an attempt is worse served by a mailbox nobody reads than by no promise.
  if (!organisation.supportEmail) return null;

  const subject = `Assessment issue — ${assessmentTitle}`;
  const body = [
    `Assessment: ${assessmentTitle}`,
    reference ? `Reference: ${reference}` : null,
    '',
    'What happened:',
    '',
    'When it happened:',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const href = `mailto:${organisation.supportEmail}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

  if (tone === 'inline') {
    return (
      <p className="sc-inline">
        Something go wrong during this assessment?{' '}
        <a href={href}>Contact {organisation.name}</a>.
      </p>
    );
  }

  return (
    <section className="card card-pad sc-card">
      <h2 className="sc-title">Something went wrong?</h2>
      <p className="sc-body">
        In case of any issues, please contact at {organisation.name} 
      </p>
      <a className="sc-link" href={href}>
        Email {organisation.supportEmail}
      </a>
    </section>
  );
}
