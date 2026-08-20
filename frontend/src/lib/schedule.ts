import type { InvitationWindow, WindowState } from './types';

/*
 * Moving between the wire's UTC and the `datetime-local` input's wall clock.
 *
 * Worth its own file because the conversion is the part that goes wrong. A
 * `datetime-local` value is a *local* wall-clock string with no zone in it, and
 * `new Date('2026-09-01T09:00')` reads it as local while
 * `new Date('2026-09-01T09:00Z')` reads it as UTC — so a recruiter in IST who
 * types 9am and gets a candidate window opening at 2:30pm has hit exactly one
 * missing conversion. Both directions live here so there is one place to be
 * right.
 */

/** ISO instant (or null) → the `YYYY-MM-DDTHH:mm` a datetime-local wants. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  // Via the local-time getters rather than toISOString(), which would render
  // the UTC wall clock and shift the number the recruiter sees.
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * A datetime-local value → an ISO instant, or null for an empty box.
 *
 * Null is meaningful to the API — it clears a bound — which is why an emptied
 * field has to reach it rather than being dropped.
 */
export function fromLocalInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  // No trailing Z: the string is local wall clock, and Date parses it as such.
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * "1h 04m" / "18m 32s" / "45s".
 *
 * Mirrors the backend's `formatDuration` so a duration reads the same in the
 * UI as in the CSV export a recruiter downloads from it.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** "1 Sep, 09:00". Compact enough to sit in a table cell. */
export function formatWhen(iso: string | null): string {
  if (!iso) return '—';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * One line describing a window, written for whoever is reading it.
 *
 * Never recomputes `state` from the browser clock — the server decides, and a
 * page that decides for itself is how a candidate ends up looking at a Start
 * button the runtime refuses.
 */
export function describeWindow(
  window: InvitationWindow,
  audience: 'candidate' | 'recruiter',
): string | null {
  const { state, opensAt, closesAt } = window;

  if (state === 'not_yet') {
    return audience === 'candidate'
      ? `Opens ${formatWhen(opensAt)}`
      : `Not open until ${formatWhen(opensAt)}`;
  }

  if (state === 'closed') {
    return audience === 'candidate'
      ? `Closed ${formatWhen(closesAt)}`
      : `Closed ${formatWhen(closesAt)}`;
  }

  // Open, and with a deadline worth stating. An open window with no closing
  // date needs no line at all — "no deadline" is not news.
  if (closesAt) {
    return audience === 'candidate'
      ? `Open until ${formatWhen(closesAt)}`
      : `Open until ${formatWhen(closesAt)}`;
  }

  return null;
}

/**
 * Pill modifier per state, so the three read differently at a glance.
 *
 * Reuses the invitation-status pill classes rather than inventing a parallel
 * set — every value here has a rule in `index.css`, so a state cannot silently
 * fall back to the neutral base style.
 */
export const WINDOW_TONE: Record<WindowState, string> = {
  open: 'completed',
  not_yet: 'pending',
  closed: 'closed',
};
