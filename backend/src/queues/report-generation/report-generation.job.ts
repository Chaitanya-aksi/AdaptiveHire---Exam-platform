/** Queue that computes a session's summary report after submission. */
export const REPORT_GENERATION_QUEUE = 'report-generation';

export interface ReportGenerationJob {
  sessionId: string;
}

/**
 * Keyed by session so a retry, a re-submit race or a manual re-run collapses
 * onto one job. Generation is idempotent, so a duplicate would be harmless —
 * this just avoids the pointless work.
 *
 * No colons: BullMQ rejects a custom job id containing one, because `:` is its
 * own Redis key separator.
 */
export function reportJobId(sessionId: string): string {
  return `report-${sessionId}`;
}
