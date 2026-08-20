import { useEffect, useState } from 'react';
import { NavLink, Outlet, useOutletContext } from 'react-router-dom';
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
          <UserMenu />
        </header>

        <main className="cand-content">
          <Outlet context={context} />
        </main>
      </div>
    </div>
  );
}
