import { useEffect, useState, type FormEvent } from 'react';
import { SubNav } from '../../components/SubNav';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../lib/auth';
import { organisationsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type { BrandingPatch, OrganisationProfile } from '../../lib/types';

/*
 * How the workspace presents itself to the candidates it assesses.
 *
 * All three fields reach people outside the company, which is why this page is
 * admin-and-above: the logo and colour are on the sign-in page a candidate is
 * asked to trust, and the support address is the one they write to when an
 * attempt goes wrong. Those are workspace decisions, not something an
 * individual hiring manager changes for their own round.
 *
 * The guard is on the server (`@MinOrgRole(OrgRole.ADMIN)`); the read-only
 * rendering below only stops a viewer being shown a form that would 403 on
 * submit.
 */

/**
 * Trimmed, with empty meaning "clear it".
 *
 * The API distinguishes an omitted field (leave alone) from an explicit null
 * (reset to AdaptiveHire's own), and a text input cannot express "omitted" —
 * so an emptied box has to become null or there would be no way to remove a
 * logo through the UI at all.
 */
function normalise(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Settings is where a person goes to change something about themselves or
 * about the workspace, and those were in two different places — branding here,
 * name and password behind the user menu. One section, two tabs.
 */
const SETTINGS_TABS = [
  { to: '/admin/settings', label: 'Workspace', end: true },
  { to: '/admin/settings/account', label: 'My account' },
];

export function Settings() {
  const toast = useToast();
  const { user: me } = useAuth();

  const canEdit = me?.orgRole === 'admin' || me?.orgRole === 'owner';

  const [profile, setProfile] = useState<OrganisationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [logoUrl, setLogoUrl] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [supportEmail, setSupportEmail] = useState('');

  useEffect(() => {
    let cancelled = false;

    organisationsApi
      .mine()
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setLogoUrl(data.logoUrl ?? '');
        setAccentColor(data.accentColor ?? '');
        setSupportEmail(data.supportEmail ?? '');
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(describeError(err, 'Could not load your workspace.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || saving) return;

    // Everything on the form every time. Partial updates matter to the API for
    // callers that send one field; here the user can see all three, so what is
    // on screen is what they mean.
    const changes: BrandingPatch = {
      logoUrl: normalise(logoUrl),
      accentColor: normalise(accentColor),
      supportEmail: normalise(supportEmail),
    };

    setSaving(true);
    setError(null);
    try {
      const updated = await organisationsApi.updateBranding(changes);
      setProfile(updated);
      toast.success('Saved. Candidates will see this on their next visit.');
    } catch (err) {
      setError(describeError(err, 'Could not save these changes.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="ci-skeleton" style={{ height: 220 }} />;

  if (!profile) {
    return (
      <div className="alert error">
        {error ?? 'Could not load your workspace.'}
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            How <strong>{profile.name}</strong> appears to the candidates you
            assess.
          </p>
          <SubNav items={SETTINGS_TABS} />
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      {!canEdit && (
        <div className="alert">
          Only an admin or the owner can change these. You can see the current
          settings below.
        </div>
      )}

      <form className="card set-card" onSubmit={(e) => void save(e)}>
        <div className="card-head">
          <h2>Candidate-facing branding</h2>
        </div>

        <div className="card-pad stack">
          <div className="field">
            <label htmlFor="set-logo">Logo URL</label>
            <input
              id="set-logo"
              type="url"
              value={logoUrl}
              disabled={!canEdit}
              placeholder="https://cdn.example.com/logo.png"
              onChange={(e) => setLogoUrl(e.target.value)}
            />
            <p className="field-note">
              Must be https — a http image is blocked as mixed content on the
              candidate portal, so it would never appear. Leave empty to show
              your company's initial instead.
            </p>
          </div>

          <div className="field">
            <label htmlFor="set-accent">Accent colour</label>
            <div className="set-colour">
              {/* The text box is the source of truth; the swatch is a picker
                  for it. A native colour input alone cannot express "unset",
                  and unset is the default state. */}
              <input
                id="set-accent"
                type="text"
                value={accentColor}
                disabled={!canEdit}
                placeholder="#2f5bea"
                onChange={(e) => setAccentColor(e.target.value)}
              />
              <input
                type="color"
                aria-label="Pick accent colour"
                value={
                  /^#[0-9a-fA-F]{6}$/.test(accentColor)
                    ? accentColor
                    : '#2f5bea'
                }
                disabled={!canEdit}
                onChange={(e) => setAccentColor(e.target.value)}
              />
            </div>
            <p className="field-note">
              Six-digit hex, such as <code>#2f5bea</code>. Leave empty for
              AdaptiveHire's own.
            </p>
          </div>

          <div className="field">
            <label htmlFor="set-support">Support email for candidates</label>
            <input
              id="set-support"
              type="email"
              value={supportEmail}
              disabled={!canEdit}
              placeholder="hiring@yourcompany.com"
              onChange={(e) => setSupportEmail(e.target.value)}
            />
            <p className="field-note">
              Shown to a candidate whose assessment was interrupted — a power
              cut, a dropped connection — so they can tell you what happened.
              The assessment clock keeps running whether or not their browser is
              open, so this is the only way they can reach you. Leave empty and
              they are shown no contact route at all.
            </p>
          </div>
        </div>

        {canEdit && (
          <div className="card-foot">
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </form>
    </>
  );
}
