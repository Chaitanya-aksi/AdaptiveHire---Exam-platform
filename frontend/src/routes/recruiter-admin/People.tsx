import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { usersApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type { CreatedUser, Paginated, UserProfile, UserRole } from '../../lib/types';

const ROLE_LABEL: Record<UserRole, string> = {
  recruiter_admin: 'Recruiter / Admin',
  candidate: 'Candidate',
};

const PAGE_SIZE = 20;

function joined(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

export function People() {
  const toast = useToast();

  const [data, setData] = useState<Paginated<UserProfile> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [page, setPage] = useState(1);

  // Add-person form.
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('candidate');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /** Shown once after a successful create — the password is not retrievable. */
  const [created, setCreated] = useState<CreatedUser | null>(null);

  const load = useCallback(() => {
    setError(null);
    usersApi
      .list({ search, role: role || undefined, page, limit: PAGE_SIZE })
      .then(setData)
      .catch((err: unknown) =>
        setError(describeError(err, 'Could not load the directory.')),
      );
  }, [search, role, page]);

  // Debounced so typing in the search box doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const resetForm = () => {
    setNewName('');
    setNewEmail('');
    setNewRole('candidate');
    setFormError(null);
  };

  const canCreate = newName.trim().length >= 2 && newEmail.trim().length > 0;

  const submitNew = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;

    setCreating(true);
    setFormError(null);
    try {
      const result = await usersApi.create(
        newName.trim(),
        newEmail.trim(),
        newRole,
      );
      setAddOpen(false);
      resetForm();
      setCreated(result);
      setPage(1);
      load();
      toast.success(`${result.user.fullName} added.`);
    } catch (err) {
      // Stay open on failure — a duplicate email is worth correcting in place.
      setFormError(describeError(err, 'Could not create the account.'));
    } finally {
      setCreating(false);
    }
  };

  const copyPassword = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.temporaryPassword);
      toast.success('Password copied.');
    } catch {
      toast.error('Could not copy — select the text and copy it manually.');
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p>Candidate and recruiter accounts on this instance.</p>
        </div>
        <button className="primary" onClick={() => setAddOpen(true)}>
          Add person
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <div className="toolbar">
          <input
            className="search"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as UserRole | '');
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            <option value="candidate">Candidates</option>
            <option value="recruiter_admin">Recruiters</option>
          </select>
          <span className="muted small">
            {data ? `${data.total} account${data.total === 1 ? '' : 's'}` : '…'}
          </span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: '32%' }}>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {data === null && (
                <tr>
                  <td colSpan={4} className="empty">
                    Loading…
                  </td>
                </tr>
              )}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    No accounts match that filter.
                  </td>
                </tr>
              )}
              {data?.items.map((person) => (
                <tr key={person.id}>
                  <td>
                    <strong>{person.fullName}</strong>
                  </td>
                  <td className="mono">{person.email}</td>
                  <td>
                    <span
                      className={`badge ${
                        person.role === 'recruiter_admin' ? 'accent' : ''
                      }`}
                    >
                      {ROLE_LABEL[person.role]}
                    </span>
                  </td>
                  <td className="muted">{joined(person.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="card-foot">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="muted small" style={{ alignSelf: 'center' }}>
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>

      <Modal
        open={addOpen}
        title="Add a person"
        onClose={() => {
          if (!creating) {
            setAddOpen(false);
            resetForm();
          }
        }}
        footer={
          <>
            <button
              onClick={() => {
                setAddOpen(false);
                resetForm();
              }}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              className="primary"
              onClick={(e) => void submitNew(e)}
              disabled={!canCreate || creating}
            >
              {creating ? 'Creating…' : 'Create account'}
            </button>
          </>
        }
      >
        <form className="stack" style={{ gap: 12 }} onSubmit={(e) => void submitNew(e)}>
          {formError && <div className="alert error">{formError}</div>}

          <div>
            <label className="field-label" htmlFor="newName">
              Full name
            </label>
            <input
              id="newName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ada Lovelace"
              maxLength={150}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="newEmail">
              Email
            </label>
            <input
              id="newEmail"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="ada@example.com"
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="newRole">
              Role
            </label>
            <select
              id="newRole"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              style={{ width: '100%' }}
            >
              <option value="candidate">Candidate</option>
              <option value="recruiter_admin">Recruiter / Admin</option>
            </select>
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              A recruiter can read the full question bank, answers included.
            </p>
          </div>

          <p className="muted small" style={{ margin: 0 }}>
            A one-time password is generated for the new account. Pass it on and
            ask them to change it after signing in.
          </p>
        </form>
      </Modal>

      <Modal
        open={created !== null}
        title="Account created"
        onClose={() => setCreated(null)}
        footer={
          <button className="primary" onClick={() => setCreated(null)}>
            Done
          </button>
        }
      >
        {created && (
          <>
            <p style={{ marginTop: 0 }}>
              <strong>{created.user.fullName}</strong> can now sign in as{' '}
              {ROLE_LABEL[created.user.role].toLowerCase()} with:
            </p>

            <div className="credential">
              <span className="muted small">Email</span>
              <code>{created.user.email}</code>
            </div>
            <div className="credential">
              <span className="muted small">One-time password</span>
              <div className="row" style={{ gap: 8 }}>
                <code>{created.temporaryPassword}</code>
                <button className="link" onClick={() => void copyPassword()}>
                  Copy
                </button>
              </div>
            </div>

            <p className="muted small" style={{ margin: '14px 0 0' }}>
              One-time password for login. Change it afterwards from{' '}
              <strong>My account</strong>.
            </p>
          </>
        )}
      </Modal>
    </>
  );
}
