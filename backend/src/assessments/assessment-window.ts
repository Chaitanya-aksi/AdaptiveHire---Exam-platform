/**
 * When a candidate may sit an assessment.
 *
 * Written once and used by both the runtime (which refuses a session outside
 * the window) and the candidate's own list (which explains why a button is not
 * there yet). The two disagreeing is the failure this file exists to prevent —
 * a candidate told "opens Tuesday" who is then refused on Tuesday, or worse, a
 * button that works when the copy beside it says it should not.
 */

/** Nulls mean "no bound", so an assessment with neither is always open. */
export interface Window {
  opensAt: Date | null;
  closesAt: Date | null;
}

export type WindowState =
  /** Sittable now. */
  | 'open'
  /** Scheduled, but not yet. */
  | 'not_yet'
  /** The window has passed. */
  | 'closed';

/**
 * One candidate's window, resolved and rendered for the wire.
 *
 * Lives here rather than beside either consumer because both the recruiter's
 * invite list and the candidate's own send it, and the whole point of this file
 * is that there is one answer to "when may they sit" rather than two.
 *
 * Both the override and the result are carried. The recruiter UI needs the
 * override to know whether "Reschedule" or "Clear override" is the honest
 * label; the resolved pair is what actually applies, and a row showing only the
 * override would read as "no window" for everybody inheriting the round's.
 */
export interface InvitationWindowView {
  /** The per-invitation override, null where it inherits the assessment's. */
  overrideOpensAt: string | null;
  overrideExpiresAt: string | null;
  /** What actually applies, after the override is layered over the round. */
  opensAt: string | null;
  closesAt: string | null;
  /**
   * Computed on the server, never in a browser. A client clock can be wrong or
   * deliberately set wrong, and the clock that decides is the one enforcing it.
   */
  state: WindowState;
}

/**
 * The window that actually applies to one candidate.
 *
 * A per-invitation value wins over the assessment's, which is what makes
 * rescheduling one person possible without moving the round for everybody. A
 * null on the invitation means "inherit", not "no bound" — otherwise setting
 * only an open time for someone would silently remove their deadline.
 */
export function effectiveWindow(
  assessment: { opensAt: Date | null; closesAt: Date | null },
  invitation: { opensAt: Date | null; expiresAt: Date | null },
): Window {
  return {
    opensAt: invitation.opensAt ?? assessment.opensAt,
    closesAt: invitation.expiresAt ?? assessment.closesAt,
  };
}

/** Where `at` falls relative to a window. */
export function windowState(
  window: Window,
  at: Date = new Date(),
): WindowState {
  const now = at.getTime();

  if (window.opensAt && now < window.opensAt.getTime()) return 'not_yet';
  if (window.closesAt && now > window.closesAt.getTime()) return 'closed';
  return 'open';
}
