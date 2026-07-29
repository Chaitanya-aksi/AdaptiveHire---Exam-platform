/** Queue that force-submits a session whose overall deadline has passed. */
export const AUTO_SUBMIT_QUEUE = 'auto-submit';

export interface AutoSubmitJob {
  sessionId: string;
}

/**
 * One delayed job per session, keyed by session id so re-enqueueing (resume,
 * restart) replaces the pending job instead of stacking duplicates.
 *
 * No colons: BullMQ rejects a custom job id containing one, because `:` is its
 * own Redis key separator.
 */
export function autoSubmitJobId(sessionId: string): string {
  return `auto-submit-${sessionId}`;
}
