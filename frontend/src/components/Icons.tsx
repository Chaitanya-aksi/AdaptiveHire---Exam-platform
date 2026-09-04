import type { SVGProps } from 'react';

/**
 * A small hand-rolled icon set.
 *
 * Inline SVG rather than an icon package: this is a dozen glyphs, and a
 * dependency would ship thousands to serve them. They inherit `currentColor` and
 * a consistent 1.6 stroke, so a tile only has to set a colour.
 *
 * `aria-hidden` throughout — every icon here sits next to its own text label, so
 * announcing it again would only add noise for a screen reader.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A clock, for how long something takes. */
export function IconClock(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

/** A waste bin: destructive, and the only icon here that stands alone. */
export function IconTrash(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </Icon>
  );
}

/** An assessment: a page with its sections ticked off. */
export function IconAssessment(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 13.5l1.5 1.5 3-3" />
      <path d="M8.5 18h7" />
    </Icon>
  );
}

/** Candidates. */
export function IconPeople(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="8" r="3.2" />
      <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4" />
      <path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6" />
    </Icon>
  );
}

/** The question bank: a stack of items. */
export function IconBank(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 3 7.5l9 4.5 9-4.5z" />
      <path d="M3 12.5 12 17l9-4.5" />
      <path d="M3 17 12 21.5 21 17" />
    </Icon>
  );
}

/** Subjects / modules: a set of tiles. */
export function IconModules(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

/** Bulk import: a sheet going up. */
export function IconImport(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15V4" />
      <path d="M8.5 7.5 12 4l3.5 3.5" />
      <path d="M4 15v3.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </Icon>
  );
}

/** A report. */
export function IconReport(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h16" />
      <rect x="5.5" y="11" width="3.5" height="6" rx="1" />
      <rect x="10.5" y="6.5" width="3.5" height="10.5" rx="1" />
      <rect x="15.5" y="9" width="3.5" height="8" rx="1" />
    </Icon>
  );
}

/** The adaptive test itself: a dial that moves with the candidate. */
export function IconAdaptive(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 14a8 8 0 0 1 16 0" />
      <path d="M12 14l4-3.5" />
      <circle cx="12" cy="14" r="1.4" />
      <path d="M4 18h16" />
    </Icon>
  );
}

/** An invitation. */
export function IconInvite(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="1.6" />
      <path d="M3.8 6.5 12 13l8.2-6.5" />
    </Icon>
  );
}

/** Hired. */
export function IconHired(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="7.5" width="18" height="12" rx="1.6" />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5" />
      <path d="M9.5 13.5l1.8 1.8 3.4-3.4" />
    </Icon>
  );
}

/** Proctoring. */
export function IconShield(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5l7 2.6v5.4c0 4-2.9 7.4-7 8.9-4.1-1.5-7-4.9-7-8.9V6.1z" />
      <path d="M9.2 12.2l1.9 1.9 3.7-3.7" />
    </Icon>
  );
}

/**
 * One person: the account menu's own entry.
 *
 * A shoulders-and-head mark rather than the avatar's initials — the initials
 * are already directly above it in the dropdown, and repeating them would be
 * the same thing twice at two sizes.
 */
export function IconUser(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20v-1a4.5 4.5 0 0 1 4.5-4.5h5A4.5 4.5 0 0 1 19 19v1" />
    </Icon>
  );
}

/** Leaving: a door with the arrow pointing out of it. */
export function IconSignOut(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 4.5h3.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3.5" />
      <path d="M10 12H4" />
      <path d="M7.5 8.5 4 12l3.5 3.5" />
    </Icon>
  );
}

export function IconArrow(props: IconProps) {
  return (
    <Icon {...props} width="16" height="16">
      <path d="M5 12h13" />
      <path d="M12.5 6.5 19 12l-6.5 5.5" />
    </Icon>
  );
}

/** A closed padlock: the account's sign-in credentials. */
export function IconLock(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2" />
    </Icon>
  );
}

/**
 * Show / hide, for a password field.
 *
 * The struck-through eye means "hidden", so it is what a field shows while the
 * characters are masked — the icon names the state you are in, not the one the
 * button would move you to, and the `aria-label` on the button carries the
 * action. Both are drawn here because the pair only makes sense together.
 */
export function IconEye(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </Icon>
  );
}

export function IconEyeOff(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M17.9 17.9A10.4 10.4 0 0 1 12 19.5C5.8 19.5 2 12 2 12a18.9 18.9 0 0 1 4.6-5.6" />
      <path d="M9.9 5.2A9.9 9.9 0 0 1 12 5c6.2 0 10 7 10 7a19 19 0 0 1-2.2 3.2" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </Icon>
  );
}
