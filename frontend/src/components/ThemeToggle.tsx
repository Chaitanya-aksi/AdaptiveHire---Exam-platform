import { useTheme, type ThemeChoice } from '../lib/theme';

/*
 * Light / System / Dark, as a three-way segmented control.
 *
 * A two-state switch cannot express "follow my computer", and that is the
 * state most people are actually in — so a switch would silently convert every
 * first toggle into a permanent override of a preference the person never knew
 * they had. Three segments make the current state and the alternatives visible
 * at once, which a switch never does.
 *
 * Radios rather than buttons: this is one setting with three values, which is
 * what a radio group is, and it gets arrow-key navigation from the browser for
 * free.
 */

const OPTIONS: { value: ThemeChoice; label: string; title: string }[] = [
  { value: 'light', label: 'Light', title: 'Always light' },
  { value: 'system', label: 'Auto', title: 'Match my system setting' },
  { value: 'dark', label: 'Dark', title: 'Always dark' },
];

function Icon({ choice }: { choice: ThemeChoice }) {
  if (choice === 'light') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="3.2" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15" />
          <path d="M3.05 3.05l1.27 1.27M11.68 11.68l1.27 1.27M12.95 3.05l-1.27 1.27M4.32 11.68l-1.27 1.27" />
        </g>
      </svg>
    );
  }

  if (choice === 'dark') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        {/* A crescent cut from one disc by another, so it stays a moon at any
            size rather than becoming a smudge. */}
        <path
          d="M13.2 10.1A5.6 5.6 0 0 1 6 2.9a5.7 5.7 0 1 0 7.2 7.2z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {/* A display: "whatever this machine says". */}
      <rect
        x="1.6"
        y="2.6"
        width="12.8"
        height="9"
        rx="1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M5.5 13.9h5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ThemeToggle() {
  const { choice, setChoice } = useTheme();

  return (
    <fieldset className="theme-toggle">
      <legend className="sr-only">Colour theme</legend>

      {OPTIONS.map((option) => (
        <label
          key={option.value}
          className={`theme-opt${choice === option.value ? ' theme-opt--on' : ''}`}
          title={option.title}
        >
          <input
            type="radio"
            name="theme"
            value={option.value}
            checked={choice === option.value}
            onChange={() => setChoice(option.value)}
          />
          <Icon choice={option.value} />
          {/* Named as well as drawn. Three unlabelled icons is a guessing game,
              and the labels collapse away on narrow screens where the icons
              have to carry it alone. */}
          <span className="theme-opt-label">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
