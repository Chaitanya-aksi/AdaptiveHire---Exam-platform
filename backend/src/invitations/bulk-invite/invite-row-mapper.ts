import type { RawRow } from '../../question-bank/bulk-import/spreadsheet-parser';

/** Thrown per-row so one bad line is reported and skipped, not fatal. */
export class InviteRowError extends Error {}

export interface InviteRow {
  /** May be empty — only used for the email greeting; the candidate sets their
   * own name when they register. */
  fullName: string;
  email: string;
}

// Deliberately permissive: catches the obvious "not an email" typos without
// rejecting valid-but-unusual addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Maps a normalised spreadsheet row to a candidate invite. Accepts either
 * `name` or `full_name` for the display name; `email` is required.
 */
export function mapInviteRow(row: RawRow): InviteRow {
  const email = row.email?.trim().toLowerCase() ?? '';
  if (!email) throw new InviteRowError('missing required column "email"');
  if (!EMAIL_RE.test(email)) {
    throw new InviteRowError(`"${email}" is not a valid email address`);
  }

  const fullName = (row.name ?? row.full_name ?? '').trim();
  return { fullName, email };
}
