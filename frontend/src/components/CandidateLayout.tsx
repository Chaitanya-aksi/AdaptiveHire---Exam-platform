import { useEffect, useState } from 'react';
import {
  NavLink,
  Outlet,
  useMatch,
  useNavigate,
  useOutletContext,
} from 'react-router-dom';
import { IconSignOut } from './Icons';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { useAuth } from '../lib/auth';
import { invitationsApi } from '../lib/endpoints';
import { describeError } from '../lib/errors';
import { useTheme, type ResolvedTheme } from '../lib/theme';
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
/** Degrees the watermark text is laid over at. Negative reads bottom-left up. */
const WATERMARK_ANGLE = 24;

/** XML-safe: an address may legitimately contain `&`, and `<` is not rejected. */
const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * One repeating tile of the account watermark, as an SVG data URI.
 *
 * A tiled background rather than a few hundred rotated `<span>`s, which is what
 * this was first built from. Spans have to be counted, and the count is a guess
 * at how tall the page will be: enough of them for a candidate's first
 * invitation left the lower two-thirds of a long list bare, and enough for a
 * long list is a thousand DOM nodes on a page that has one card. A tile has no
 * height to guess at — it repeats to whatever the column turns out to be.
 *
 * The tile is sized from the address so it can never clip its own text: a
 * rotated string of width `w` needs `w·cos θ` across and `w·sin θ` down, and the
 * padding on top of that is what becomes the spacing between repeats.
 *
 * The ink is baked in rather than inherited, because a background image has no
 * CSS context to read `currentColor` from — hence the resolved theme as an
 * argument. `opacity` stays in the stylesheet, where it can be tuned per theme.
 */
function watermarkTile(email: string, theme: ResolvedTheme): string {
  const radians = (WATERMARK_ANGLE * Math.PI) / 180;
  // Approximate rather than measured: this only has to be generous enough that
  // the glyphs never touch the tile edge, and being a little wide simply spaces
  // the repeats out. Measuring in a canvas would be exact and would also make
  // this a layout effect that reruns on every font swap.
  const textWidth = email.length * 7.4 + 12;

  const width = Math.ceil(textWidth * Math.cos(radians)) + 92;
  const height = Math.ceil(textWidth * Math.sin(radians)) + 64;
  const baseline = height - 18;
  const ink = theme === 'dark' ? '#ffffff' : '#000000';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<text x="12" y="${baseline}" transform="rotate(-${WATERMARK_ANGLE} 12 ${baseline})" ` +
    `fill="${ink}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" ` +
    `font-size="13" font-weight="600" letter-spacing="0.8">${escapeXml(email)}</text>` +
    `</svg>`;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function CandidateLayout() {
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();

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

  const signOut = async () => {
    await logout();
    void navigate('/login', { replace: true });
  };

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

              {/*
               * Sign-out sits at the foot of the panel, under a rule.
               *
               * It is the second one on the page — the account menu in the top
               * bar has the same action — and that is deliberate rather than an
               * oversight. A candidate has two destinations, so the panel ended
               * in a band of empty gradient below two links, and the way out of
               * the product was folded inside a menu that has to be opened to
               * find out what is in it. This is the one action on this side of
               * the page that people look for and expect to see.
               *
               * A button, not a link: it ends a session rather than going
               * somewhere, and it is styled as the quietest thing in the nav so
               * it never competes with the assessments themselves.
               */}
              <button
                type="button"
                className="cand-signout"
                onClick={() => void signOut()}
              >
                <IconSignOut width={16} height={16} aria-hidden="true" />
                Sign out
              </button>
            </nav>
          </div>
        </div>
      </aside>

      {/* ══ RIGHT — the working column ═══════════════════════════════════ */}
      <div className="cand-main">
        {/*
         * The signed-in address, tiled faintly across the whole column.
         *
         * Whose screen this is, stated on every page — the same reassurance a
         * candidate gets from seeing their own name on a paper they have been
         * handed, and a discouragement to passing a screenshot of somebody
         * else's assessment around as their own.
         *
         * Rendered here rather than per page so it covers the column at its
         * full scrolled height and cannot be forgotten on a page added later.
         * It is `aria-hidden` and unselectable: it is texture, and a screen
         * reader announcing an address ninety times is not.
         *
         * Deliberately absent from the assessment runtime, which mounts outside
         * this layout: nothing decorative belongs behind a timed question, and
         * the same text under every option is exactly the kind of visual noise
         * the runtime strips out.
         */}
        {user?.email && (
          <div
            className="cand-watermark"
            aria-hidden="true"
            style={{ backgroundImage: watermarkTile(user.email, theme) }}
          />
        )}

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
