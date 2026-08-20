import { useEffect, useState, type FormEvent } from 'react';
import { SubNav } from '../components/SubNav';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { usersApi } from '../lib/endpoints';
import { describeError } from '../lib/errors';
import type { UserProfile, UserRole } from '../lib/types';

const ROLE_LABEL: Record<UserRole, string> = {
  recruiter_admin: 'Recruiter / Admin',
  candidate: 'Candidate',
};

/** Up to two initials from a display name, for the avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

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

  // Name editing.
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Password change.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    usersApi
      .me()
      .then((me) => {
        if (cancelled) return;
        setProfile(me);
        setName(me.fullName);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setLoadError(describeError(err, 'Could not load your profile.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nameDirty = profile !== null && name.trim() !== profile.fullName;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!nameDirty || name.trim().length < 2) return;
    setSavingName(true);
    try {
      const updated = await usersApi.updateName(name.trim());
      setProfile(updated);
      setName(updated.fullName);
      updateUser({ fullName: updated.fullName }); // keep the top-bar menu in sync
      toast.success('Name updated.');
    } catch (err) {
      toast.error(describeError(err, 'Could not update your name.'));
    } finally {
      setSavingName(false);
    }
  };

  const passwordValid =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword;

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters.');
      return;
    }
    setSavingPassword(true);
    try {
      await usersApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed.');
    } catch (err) {
      toast.error(describeError(err, 'Could not change your password.'));
    } finally {
      setSavingPassword(false);
    }
  };

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

        <form className="card" onSubmit={(e) => void saveName(e)}>
          <div className="card-head">
            <h2>Display name</h2>
          </div>
          <div className="card-pad">
            <label className="field-label" htmlFor="fullName">
              Full name
            </label>
            <input
              id="fullName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={150}
              style={{ width: '100%', maxWidth: 360 }}
            />
            <p className="muted small" style={{ margin: '8px 0 0' }}>
              This is how your name appears across AdaptiveHire.
            </p>
          </div>
          <div className="card-foot">
            <button
              type="submit"
              className="primary"
              disabled={!nameDirty || name.trim().length < 2 || savingName}
            >
              {savingName ? 'Saving…' : 'Save name'}
            </button>
          </div>
        </form>

        <form className="card" onSubmit={(e) => void changePassword(e)}>
          <div className="card-head">
            <h2>Change password</h2>
          </div>
          <div className="card-pad stack" style={{ gap: 12 }}>
            <div>
              <label className="field-label" htmlFor="currentPassword">
                Current password
              </label>
              <input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                style={{ width: '100%', maxWidth: 360 }}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="newPassword">
                New password
              </label>
              <input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{ width: '100%', maxWidth: 360 }}
              />
              <p className="muted small" style={{ margin: '6px 0 0' }}>
                At least 8 characters.
              </p>
            </div>
            <div>
              <label className="field-label" htmlFor="confirmPassword">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{ width: '100%', maxWidth: 360 }}
              />
              {confirmPassword.length > 0 &&
                confirmPassword !== newPassword && (
                  <p
                    className="small"
                    style={{ margin: '6px 0 0', color: 'var(--danger)' }}
                  >
                    Passwords don&rsquo;t match.
                  </p>
                )}
            </div>
          </div>
          <div className="card-foot">
            <button
              type="submit"
              className="primary"
              disabled={!passwordValid || savingPassword}
            >
              {savingPassword ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
