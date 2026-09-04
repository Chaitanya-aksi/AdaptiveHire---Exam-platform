import { useEffect, useState } from 'react';
import { NavLink, Outlet, useMatch, useOutletContext } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { useAuth } from '../lib/auth';
import { invitationsApi } from '../lib/endpoints';
import { describeError } from '../lib/errors';
import type { CandidateInvitation } from '../lib/types';

/**
 * What the layout loads once and both halves read: the panel counts the
 * invitations, the page lists them.
 *
 * Fetching here rather than in the page is what lets the greeting say something
 * true ("2 waiting") instead of a generic line — and it is one request either
 * way, since the page reads the same array through the outlet context.
 */
export interface CandidateOutletContext {
  invites: CandidateInvitation[];
  loading: boolean;
  error: string | null;
}

/** The invitation list loaded by `CandidateLayout`, for the pages under it. */
export function useCandidateInvites(): CandidateOutletContext {
  return useOutletContext<CandidateOutletContext>();
}

/** Anything the candidate can still act on, as opposed to already sat. */
const isOpen = (invite: CandidateInvitation) =>
  invite.status === 'pending' || invite.status === 'in_progress';

/** First name only — the panel greets, it doesn't address an envelope. */
function firstName(fullName: string | undefined): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0];
  return first || 'there';
}

const NAV = [
  { to: '/assessments', label: 'My assessments', end: true },
  { to: '/assessments/profile', label: 'My account', end: false },
];

/** One place a candidate can write to, and who answers there. */
interface SupportRoute {
  email: string;
  organisation: string;
}

/**
 * Where this candidate can ask for help, taken from the invitations the layout
 * has already loaded.
 *
 * Support is the inviting company's job, not the platform's: they are the only
 * ones who can act on a lost attempt, and a candidate has no organisation of
 * their own to fall back on. The server has already decided each address — the
 * company's own, else the platform's, else null — so nothing here chooses
 * between two, it only removes duplicates.
 *
 * Keyed on the address rather than the name, because two rounds from one
 * company share an inbox and must not be listed twice.
 */
function supportRoutes(invites: CandidateInvitation[]): SupportRoute[] {
  const byEmail = new Map<string, string>();
  for (const invite of invites) {
    const email = invite.organisation.supportEmail;
    if (email && !byEmail.has(email)) byEmail.set(email, invite.organisation.name);
  }
  return [...byEmail].map(([email, organisation]) => ({ email, organisation }));
}

/**
 * Subject only — no prefilled body.
 *
 * `SupportContact` fills one in because it is raised from a specific attempt
 * and can name it. This link is reached from anywhere in the portal, so it
 * cannot know what went wrong, and a template of empty headings would be a
 * form to fill in rather than a way to ask a question.
 */
const supportHref = (route: SupportRoute) =>
  `mailto:${route.email}?subject=${encodeURIComponent(
    'AdaptiveHire — help with my assessment',
  )}`;

/**
 * The candidate's shell: a fixed brand panel down the left, the working column
 * on the right — the same split as the sign-in pages, so signing in doesn't
 * drop you somewhere that looks like a different product.
 *
 * Deliberately not the recruiter's `AppLayout`. A candidate has two
 * destinations, so a top nav bar built to carry six leaves the page looking
 * unfinished; the panel gives that space to the greeting and to what they were
 * invited to instead.
 */
export function CandidateLayout() {
  const { user } = useAuth();

  const [invites, setInvites] = useState<CandidateInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    invitationsApi
      .mine()
      .then((rows) => {
        if (!cancelled) setInvites(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(describeError(err, 'Could not load your assessments.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const context: CandidateOutletContext = { invites, loading, error };
  const routes = supportRoutes(invites);

  /*
   * One page raises support itself and does it better: the attempt view names
   * the assessment and prefills a reference the recruiter can look that exact
   * attempt up by. Four lines below it, this footer was the same address under
   * a vaguer heading — the same sentence twice, with the weaker one last.
   *
   * Read off the route rather than signalled up from the page, because a child
   * telling its layout what to render has to do it in an effect, and the footer
   * would then flash in and back out on every navigation to that page.
   *
   * `:invitationId` matches any single segment, `/assessments/profile`
   * included, so that one is excluded by name — it has no support card of its
   * own and should keep the footer.
   */
  const attemptPage = useMatch('/assessments/:invitationId');
  const pageRaisesSupport =
    attemptPage !== null && attemptPage.params.invitationId !== 'profile';

  const open = invites.filter(isOpen).length;
  const submitted = invites.filter((i) => i.status === 'completed').length;

  // The panel is the first thing read on the page, so it should never sit
  // there asserting "0 waiting" while the request is still in flight.
  const summary = loading
    ? 'Fetching your assessments…'
    : error
      ? 'We could not reach your assessments just now.'
      : invites.length === 0
        ? 'Nothing has been assigned to you yet. This is where it will appear.'
        : open > 0
          ? `You have ${open} assessment${open === 1 ? '' : 's'} waiting for you.`
          : 'You are all caught up — everything you were sent is submitted.';

  return (
    <div className="cand-shell">
      {/* ══ LEFT — brand panel ═══════════════════════════════════════════ */}
      <aside className="cand-panel" aria-label="Your account">
        {/*
         * The panel stretches to the full page height so the gradient never
         * runs out under a long list, while this inner box is what actually
         * sticks at one viewport tall. Sticky has to live here rather than on
         * `.cand-panel`, because the clipping that keeps the orbs inside the
         * panel would otherwise be an overflow ancestor and stop it sticking.
         */}
        <div className="cand-panel-sticky">
          <div className="cand-panel-bg" aria-hidden="true">
            <div className="cand-orb cand-orb--1" />
            <div className="cand-orb cand-orb--2" />
            <div className="cand-orb cand-orb--3" />
            <div className="cand-arc cand-arc--1" />
            <div className="cand-arc cand-arc--2" />
            <div className="cand-grid" />
          </div>

          <div className="cand-panel-inner">
            <header className="cand-brand">
              <div className="cand-brand-row">
                <span className="cand-mark" aria-hidden="true">
                  A
                </span>
                <span className="cand-brand-name">AdaptiveHire</span>
              </div>
              <p className="cand-tagline">Assess · Adapt · Achieve</p>
            </header>

            <div className="cand-greeting">
              <h1>
                <span className="cand-hello">Hello,</span>
                <span className="cand-name">{firstName(user?.fullName)}.</span>
              </h1>
              <p className="cand-summary">{summary}</p>

              <div className="cand-stats">
                <div className="cand-stat">
                  <strong>{loading ? '—' : open}</strong>
                  <span>To take</span>
                </div>
                <div className="cand-stat">
                  <strong>{loading ? '—' : submitted}</strong>
                  <span>Submitted</span>
                </div>
              </div>
            </div>

            <nav className="cand-nav">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end}>
                  <span className="cand-nav-dot" aria-hidden="true" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </aside>

      {/* ══ RIGHT — the working column ═══════════════════════════════════ */}
      <div className="cand-main">
        <header className="cand-topbar">
          {/* Only visible once the panel has collapsed away above it. */}
          <span className="cand-topbar-brand">
            <span className="cand-mark cand-mark--sm" aria-hidden="true">
              A
            </span>
            AdaptiveHire
          </span>
          <div className="topbar-end">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main className="cand-content">
          <Outlet context={context} />
        </main>

        {/*
         * Rendered only when there is somewhere real to write.
         *
         * The same rule `SupportContact` states and for the same reason: a
         * candidate who cannot start an assessment is worse served by an
         * address nobody reads than by no address at all. So no placeholder,
         * and nothing at all while the invitations are still loading.
         *
         * It sits in `.cand-main` rather than across the shell so it ends the
         * column the candidate is actually reading, and it is outside the test
         * runtime by construction — that route deliberately does not mount
         * this layout, and a way out of the page is the last thing a timed,
         * proctored screen should offer.
         */}
        {routes.length > 0 && !pageRaisesSupport && (
          <footer className="cand-foot">
            <span className="cand-foot-label">Need help?</span>{' '}
            {routes.length === 1 ? (
              <span>
                Contact {routes[0].organisation} at{' '}
                <a href={supportHref(routes[0])}>{routes[0].email}</a>.
              </span>
            ) : (
              // Names rather than addresses once there is more than one: the
              // question this list answers is which company to write to, and
              // three addresses in a row answers a question nobody asked.
              <span>
                Contact whoever invited you —{' '}
                {routes.map((route, i) => (
                  <span key={route.email}>
                    {i > 0 && ' · '}
                    <a href={supportHref(route)} title={route.email}>
                      {route.organisation}
                    </a>
                  </span>
                ))}
                .
              </span>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
