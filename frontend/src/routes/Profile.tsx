import { useEffect, useState } from 'react';
import { ChangePasswordDialog } from '../components/ChangePasswordDialog';
import { EditNameDialog } from '../components/EditNameDialog';
import { IconLock, IconUser } from '../components/Icons';
import { SubNav } from '../components/SubNav';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { usersApi } from '../lib/endpoints';
import { describeError } from '../lib/errors';
import { initials } from '../lib/initials';
import type { UserProfile, UserRole } from '../lib/types';

const ROLE_LABEL: Record<UserRole, string> = {
  recruiter_admin: 'Recruiter / Admin',
  candidate: 'Candidate',
};

function memberSince(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Same two tabs as `Settings.tsx`, which mounts the other one. */
const SETTINGS_TABS = [
  { to: '/admin/settings', label: 'Workspace', end: true },
  { to: '/admin/settings/account', label: 'My account' },
];

/** Shared "My account" screen — mounted for both recruiter and candidate. */
export function Profile() {
  const { user, updateUser } = useAuth();
  const toast = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Both forms live in dialogs, so all this page holds is which one is open.
  const [editingName, setEditingName] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    usersApi
      .me()
      .then((me) => {
        if (cancelled) return;
        setProfile(me);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setLoadError(describeError(err, 'Could not load your profile.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const display = profile ?? user;
  const recruiter = display?.role === 'recruiter_admin';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{recruiter ? 'Settings' : 'My account'}</h1>
          <p>Manage your profile and sign-in details.</p>
          {/* Tabs only for a recruiter. A candidate has no workspace to
              configure, so this is their whole account page and a strip with
              one usable tab on it would be furniture. */}
          {recruiter && <SubNav items={SETTINGS_TABS} />}
        </div>
      </div>

      {loadError && <div className="alert error">{loadError}</div>}

      <div className="stack" style={{ maxWidth: 640 }}>
        <div className="card card-pad">
          <div className="profile-identity">
            <div className="avatar avatar-lg">
              {display ? initials(display.fullName) : '?'}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="profile-name">{display?.fullName ?? '—'}</div>
              <div className="muted profile-email">{display?.email ?? '—'}</div>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="badge accent">
                  {display ? ROLE_LABEL[display.role] : '—'}
                </span>
                {profile && (
                  <span className="muted small">
                    Member since {memberSince(profile.createdAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/*
          Both cards below are a statement of fact with an action beside it,
          rather than a form standing permanently open. Most visits to this page
          are to read something — your name, your role, when you joined — and a
          page led by input boxes asks a question of everybody who came only to
          look. The name box also printed an answer already given twice above
          it, on the identity card and in the top bar. This is the shape every
          production settings page uses, for both reasons.
        */}
        <div className="card">
          <div className="card-head">
            <h2>Display name</h2>
          </div>
          <div className="card-pad">
            <div className="setting-row">
              <span className="setting-icon" aria-hidden="true">
                <IconUser width={19} height={19} />
              </span>

              <div className="setting-text">
                <div className="setting-value">{display?.fullName ?? '—'}</div>
                <p className="muted small">
                  This is how your name appears across AdaptiveHire.
                </p>
              </div>

              <button
                type="button"
                className="setting-action"
                onClick={() => setEditingName(true)}
                disabled={!display}
              >
                Edit name
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Password</h2>
          </div>
          <div className="card-pad">
            <div className="setting-row">
              <span className="setting-icon" aria-hidden="true">
                <IconLock width={19} height={19} />
              </span>

              <div className="setting-text">
                <div className="setting-value setting-value--mask">
                  {/* Not a real length — a password's length is not something
                      to publish. A fixed run of dots says "one is set" and
                      says nothing else. */}
                  ••••••••••
                </div>
                <p className="muted small">
                  Used to sign in to AdaptiveHire with{' '}
                  <strong>{display?.email ?? 'your email address'}</strong>.
                </p>
              </div>

              <button
                type="button"
                className="setting-action"
                onClick={() => setChangingPassword(true)}
                disabled={!display}
              >
                Change password
              </button>
            </div>
          </div>
        </div>
      </div>

      {display && (
        <>
          <EditNameDialog
            open={editingName}
            currentName={display.fullName}
            onClose={() => setEditingName(false)}
            onSaved={(updated) => {
              setProfile(updated);
              // Keeps the top bar's name and initials in step without a second
              // fetch — this page and that menu read from different sources.
              updateUser({ fullName: updated.fullName });
              setEditingName(false);
              toast.success('Name updated.');
            }}
          />

          <ChangePasswordDialog
            open={changingPassword}
            email={display.email}
            onClose={() => setChangingPassword(false)}
            onChanged={() => {
              setChangingPassword(false);
              toast.success('Password changed.');
            }}
          />
        </>
      )}
    </>
  );
}
