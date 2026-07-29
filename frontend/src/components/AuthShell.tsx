import type { ReactNode } from 'react';

interface AuthShellProps {
  /** Headline on the form side. */
  title: string;
  subtitle: string;
  children: ReactNode;
  /** "Don't have an account?" style row under the form. */
  footer?: ReactNode;
}

/**
 * Sign-in is unauthenticated, so this panel is read by candidates as often as
 * by recruiters. Keep it to logistics only.
 *
 * Two things must stay off this page.
 *
 * How scoring works: that difficulty adapts, that objective modules run on an
 * Elo scale, that personality options carry trait weights. A candidate who
 * knows the test adapts can read their own progress from question difficulty;
 * one who knows personality answers map to traits answers as the ideal hire
 * rather than honestly, which is exactly the measurement those modules exist
 * to make.
 *
 * What monitoring does and doesn't do — including its limits. "No video is
 * stored", "nothing is auto-disqualified" and the like are reassuring and true,
 * but they price the risk of cheating for the reader. The pre-test brief names
 * what is recorded and stops there; it does not name the limits either, and
 * neither should this page.
 *
 * Logistics are fine. Mechanics live behind the recruiter routes.
 */
const HIGHLIGHTS = [
  {
    title: 'Read the brief first',
    body: 'Every assessment opens with its rules and instructions — you confirm them before the timer starts.',
  },
  {
    title: 'Plan the sitting',
    body: 'Sections and time limits are shown up front. Once a section starts, its clock keeps running.',
  },
  {
    title: 'Set up your space',
    body: 'A quiet room, a stable connection, and no interruptions.',
  },
];

/**
 * The two-panel frame shared by sign-in and sign-up: a fixed brand/pitch panel
 * on the left, the form on the right. The panel collapses away below 900px so
 * the form gets the whole screen on a phone.
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="brand auth-brand">
          <span className="brand-mark">A</span>
          AdaptiveHire
        </div>

        <div className="auth-pitch">
          <h2>Ready when you are.</h2>
          <p>
            AdaptiveHire runs the assessment side of hiring — from the
            invitation through to the result.
          </p>

          <ul className="auth-highlights">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title}>
                <span className="auth-tick" aria-hidden="true">
                  ✓
                </span>
                <span>
                  <strong>{item.title}</strong>
                  {item.body}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="auth-foot-note">
          Trouble signing in? Ask whoever invited you.
        </p>
      </aside>

      <main className="auth-main">
        <div className="auth-panel">
          <div className="brand auth-brand-compact">
            <span className="brand-mark">A</span>
            AdaptiveHire
          </div>

          <div className="auth-head">
            <h1>{title}</h1>
            <p className="muted">{subtitle}</p>
          </div>

          {children}

          {footer && <div className="auth-alt">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
