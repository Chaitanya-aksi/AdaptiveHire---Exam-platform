import { useEffect, useState } from 'react';
import { CompanyManager } from '../../components/CompanyManager';
import { SubNav } from '../../components/SubNav';
import { useAuth } from '../../lib/auth';
import { organisationsApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type { OrganisationProfile } from '../../lib/types';

/*
 * How the workspace and its companies present themselves to candidates.
 *
 * This page used to carry its own branding form above the company list, and the
 * two read as rivals: both offered a logo, an accent and a support address, and
 * nothing said which one a candidate would actually get. They are now a single
 * list in `CompanyManager`, where the workspace is the last row and is labelled
 * as the fallback — because that is exactly what it is, both for an assessment
 * that names no company and for any field a company leaves blank.
 *
 * This component is left owning the organisation profile rather than pushing
 * the fetch down, because the page heading names the workspace too, and one
 * request feeding both is what stops the heading and the list disagreeing after
 * an edit.
 *
 * Admin-and-above: everything here reaches people outside the company. The
 * guard is on the server (`@MinOrgRole(OrgRole.ADMIN)`); the read-only
 * rendering only avoids showing controls that would 403 on submit.
 */

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
  const { user: me } = useAuth();

  const canEdit = me?.orgRole === 'admin' || me?.orgRole === 'owner';

  const [profile, setProfile] = useState<OrganisationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    organisationsApi
      .mine()
      .then((data) => {
        if (!cancelled) setProfile(data);
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
            How <strong>{profile.name}</strong> and the businesses it hires for
            appear to the candidates you assess.
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

      <CompanyManager
        canEdit={canEdit}
        organisation={profile}
        onOrganisationChange={setProfile}
      />
    </>
  );
}
