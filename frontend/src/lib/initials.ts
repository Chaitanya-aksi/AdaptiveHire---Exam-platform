/**
 * Up to two initials from a display name, for an avatar.
 *
 * Lives here rather than beside any one avatar because three places draw one —
 * the top-bar menu, its dropdown, and the account page — and they were starting
 * to disagree: `UserMenu` accepted `undefined` and `Profile` did not, so the
 * same missing name rendered "?" in the corner and threw on the page. It is
 * also why `UserMenu` exported a function at all, which was the one thing
 * keeping it off React's fast-refresh path.
 *
 * First and last, never the middle: "Ada Byron King" is AK, because a middle
 * name is the part people drop and an avatar that changes when they do is not
 * recognisable.
 */
export function initials(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (parts[0][0] + last).toUpperCase();
}
