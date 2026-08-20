import { useEffect, useState } from 'react';

/*
 * The branded pause between one stage of an assessment and the next.
 *
 * It exists for two reasons, and only one of them is decoration. A candidate
 * moving from the system checks into practice, and again from practice into
 * the real thing, needs to know unambiguously *which* of those they are about
 * to be in — the sample questions and the assessment deliberately use the same
 * controls, so without a marker between them the moment answers start counting
 * passes unannounced. Second, the next screen has work to do before it can
 * paint, and a held beat is a better way to spend that than a half-built page.
 *
 * The timing is fixed rather than tied to loading. This is a signpost, not a
 * spinner: it should last long enough to read and never longer, which a
 * progress bar chasing a fast network cannot promise.
 */

interface SectionSplashProps {
  /** The stage being entered — "Sample test", the assessment's own name. */
  title: string;
  /** One line under it, saying what that stage is. */
  subtitle: string;
  onDone: () => void;
}

/** Long enough to read the title and register the change. */
const HOLD_MS = 2200;
/** The fade-out, which has to finish before the next screen mounts. */
const EXIT_MS = 420;

export function SectionSplash({ title, subtitle, onDone }: SectionSplashProps) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Two timers rather than an `animationend` listener: a candidate whose
    // browser has reduced-motion enabled gets no animation to end, and hanging
    // the only route into the assessment off an event that may never fire is
    // not a trade worth making for one saved timer.
    const hold = window.setTimeout(() => setLeaving(true), HOLD_MS);
    const exit = window.setTimeout(onDone, HOLD_MS + EXIT_MS);

    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(exit);
    };
  }, [onDone]);

  return (
    <div
      className={`splash${leaving ? ' splash--leaving' : ''}`}
      role="status"
      aria-live="polite"
    >
      {/* Drawn behind everything and never announced: two slow arcs and a
          grain, the same language as the candidate shell's brand panel. */}
      <div className="splash-bg" aria-hidden="true">
        <span className="splash-arc splash-arc--1" />
        <span className="splash-arc splash-arc--2" />
      </div>

      <div className="splash-inner">
        <div className="splash-brand">
          <span className="splash-mark" aria-hidden="true">
            A{/* The ring that sweeps once around the mark as it lands. */}
            <span className="splash-ring" />
          </span>
          <span className="splash-name">AdaptiveHire</span>
        </div>

        <span className="splash-rule" aria-hidden="true" />

        <h1 className="splash-title">{title}</h1>
        <p className="splash-sub">{subtitle}</p>

        {/* Fills across the hold, so the pause reads as deliberate rather than
            as the page having stalled. */}
        <span className="splash-progress" aria-hidden="true">
          <span />
        </span>
      </div>
    </div>
  );
}
