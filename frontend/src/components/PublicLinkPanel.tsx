import { useEffect, useState } from 'react';
import { useToast } from './Toast';
import { assessmentsApi } from '../lib/endpoints';
import { describeError } from '../lib/errors';
import { formatWhen, fromLocalInput, toLocalInput } from '../lib/schedule';
import type { PublicLink, PublicLinkPatch, PublicLinkState } from '../lib/types';

/**
 * The shareable link for one assessment.
 *
 * Lives on the invite page because that is where the question "how do
 * candidates get in?" is asked, and — while invitation email is undeliverable
 * from production — this is the answer rather than the alternative. See
 * `docs/public-assessment-links.md`.
 *
 * What it deliberately does not do is pretend the link can be looked up again.
 * Only a hash is stored, so the URL exists in this component's state for as
 * long as the page is open and nowhere else afterwards.
 */

/** What each state means to the person managing the link, not to a candidate. */
const STATE_NOTE: Record<PublicLinkState, string> = {
  open: 'Anyone with this link can start the assessment.',
  not_configured: 'No link yet.',
  disabled: 'Switched off. Candidates opening it are told the round is closed.',
  expired: 'Past its expiry, or past this assessment’s own closing date.',
  not_yet: 'This assessment has not opened yet, so the link will not admit anyone.',
  full: 'The attempt cap has been reached. Raise it to let more people in.',
};

export function PublicLinkPanel({ assessmentId }: { assessmentId: string }) {
  const toast = useToast();

  const [link, setLink] = useState<PublicLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The URL, held only while this page is open.
   *
   * Null after a reload even when a link exists, and that is not a bug to fix
   * later — the server stores a hash and genuinely cannot return the URL again.
   */
  const [url, setUrl] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [maxAttempts, setMaxAttempts] = useState('');
  const [emailDomain, setEmailDomain] = useState('');

  useEffect(() => {
    assessmentsApi
      .publicLink(assessmentId)
      .then((data) => {
        setLink(data);
        setExpiresAt(toLocalInput(data.expiresAt));
        setMaxAttempts(data.maxAttempts === null ? '' : String(data.maxAttempts));
        setEmailDomain(data.emailDomain ?? '');
      })
      .catch((err: unknown) => setError(describeError(err, 'Could not load the link.')))
      .finally(() => setLoading(false));
  }, [assessmentId]);

  /** The three settings as the API wants them: null clears, value sets. */
  const settingsPatch = (): PublicLinkPatch => ({
    // `fromLocalInput` returns null for an empty box, which is what
    // clears the setting — an omitted field would leave it alone instead.
    expiresAt: fromLocalInput(expiresAt),
    maxAttempts: maxAttempts.trim() ? Number(maxAttempts) : null,
    emailDomain: emailDomain.trim() ? emailDomain.trim() : null,
  });

  const run = async (
    work: () => Promise<void>,
    failure: string,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(describeError(err, failure));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const minted = await assessmentsApi.rotatePublicLink(
        assessmentId,
        settingsPatch(),
      );
      setLink(minted.link);
      setUrl(minted.url);
      setSettingsOpen(false);
      toast.success('Link created. Copy it now — it is not shown again.');
    }, 'Could not create the link.');

  const saveSettings = () =>
    run(async () => {
      setLink(await assessmentsApi.updatePublicLink(assessmentId, settingsPatch()));
      setSettingsOpen(false);
      toast.success('Link settings saved.');
    }, 'Could not save the settings.');

  const setEnabled = (enabled: boolean) =>
    run(async () => {
      setLink(await assessmentsApi.updatePublicLink(assessmentId, { enabled }));
    }, 'Could not change the link.');

  const revoke = () =>
    run(async () => {
      setLink(await assessmentsApi.revokePublicLink(assessmentId));
      setUrl(null);
      toast.success('Link deleted. Attempts already made are untouched.');
    }, 'Could not delete the link.');

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied.');
    } catch {
      toast.error('Could not copy — select the link and copy it manually.');
    }
  };

  if (loading) {
    return (
      <div className="card card-pad">
        <div className="muted small">Loading the shareable link…</div>
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <div className="spread">
        <div>
          <h2>Shareable link</h2>
          <p className="muted small" style={{ margin: '3px 0 0' }}>
            One link for the whole round. Candidates open it, enter their email,
            choose a password and start — no invitation email needed.
          </p>
        </div>
        {link?.configured && (
          <span className={`badge ${link.state === 'open' ? 'active' : 'archived'}`}>
            {link.state === 'open' ? 'Open' : 'Closed'}
          </span>
        )}
      </div>

      {error && (
        <div className="alert error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {/*
        Shown once, immediately after minting, and never again — the server
        keeps only a hash. Saying so here is the whole point of the box: a
        recruiter who closes the tab assuming they can come back for it has
        lost the link and has to reissue, which invalidates the one they may
        already have sent.
      */}
      {url && (
        <div className="pl-url">
          <code>{url}</code>
          <button className="primary" onClick={() => void copy()}>
            Copy
          </button>
          <p className="field-note">
            Copy this now. It is not stored in full and cannot be shown again —
            losing it means creating a new one, which stops the old one working.
          </p>
        </div>
      )}

      {link?.configured ? (
        <>
          <dl className="pl-facts">
            <div>
              <dt>Status</dt>
              <dd>{STATE_NOTE[link.state]}</dd>
            </div>
            <div>
              <dt>Attempts</dt>
              <dd>
                {link.attemptsUsed}
                {link.maxAttempts !== null ? ` of ${link.maxAttempts}` : ''} so far
                {/* Recruiter-created invitations are excluded on purpose: a cap
                    exists to bound what a leaked link can harvest, and inviting
                    somebody by name should not eat into it. */}
                <span className="muted small"> · self-registered only</span>
              </dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>
                {link.expiresAt
                  ? formatWhen(link.expiresAt)
                  : 'When this assessment closes'}
              </dd>
            </div>
            <div>
              <dt>Restricted to</dt>
              <dd>{link.emailDomain ? `@${link.emailDomain}` : 'Any email address'}</dd>
            </div>
          </dl>

          <div className="row" style={{ marginTop: 14 }}>
            <button
              onClick={() => void setEnabled(!link.enabled)}
              disabled={busy}
            >
              {link.enabled ? 'Close the link' : 'Reopen the link'}
            </button>
            <button onClick={() => setSettingsOpen((open) => !open)} disabled={busy}>
              {settingsOpen ? 'Cancel' : 'Change settings'}
            </button>
            {/* Minting is also how a link that has spread too far is killed:
                the previous one stops working the moment this returns. */}
            <button onClick={() => void create()} disabled={busy}>
              Replace with a new link
            </button>
            <button className="danger" onClick={() => void revoke()} disabled={busy}>
              Delete
            </button>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div className="row">
            <button className="primary" onClick={() => void create()} disabled={busy}>
              {busy ? 'Creating…' : 'Create a link'}
            </button>
            <button onClick={() => setSettingsOpen((open) => !open)} disabled={busy}>
              {settingsOpen ? 'Hide limits' : 'Set limits first'}
            </button>
          </div>
          <p className="field-note">
            Anyone holding the link can start the assessment, so a self-registered
            attempt is weaker evidence than an invited one — the results list says
            which is which.
          </p>
        </div>
      )}

      {settingsOpen && (
        <div className="pl-settings">
          <div className="field">
            <label htmlFor="pl-expires">Link expires</label>
            <input
              id="pl-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            <p className="field-note">
              Leave empty to let this assessment’s own closing date govern it.
            </p>
          </div>

          <div className="field">
            <label htmlFor="pl-max">Maximum attempts</label>
            <input
              id="pl-max"
              type="number"
              min={1}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(e.target.value)}
              placeholder="No limit"
            />
            <p className="field-note">
              Bounds what a link can produce if it spreads further than intended.
            </p>
          </div>

          <div className="field">
            <label htmlFor="pl-domain">Only accept one email domain</label>
            <input
              id="pl-domain"
              value={emailDomain}
              onChange={(e) => setEmailDomain(e.target.value)}
              placeholder="college.edu"
            />
            <p className="field-note">
              The tightest control available without a list of invitees — a
              campus round restricted to one college’s addresses.
            </p>
          </div>

          {link?.configured && (
            <button
              className="primary"
              onClick={() => void saveSettings()}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
