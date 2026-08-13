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

export function IconArrow(props: IconProps) {
  return (
    <Icon {...props} width="16" height="16">
      <path d="M5 12h13" />
      <path d="M12.5 6.5 19 12l-6.5 5.5" />
    </Icon>
  );
}
