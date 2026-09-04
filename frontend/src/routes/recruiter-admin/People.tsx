import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../lib/auth';
import { usersApi } from '../../lib/endpoints';
import { describeError } from '../../lib/errors';
import type {
  CreatedUser,
  OrgRole,
  Paginated,
  UserProfile,
  UserRole,
} from '../../lib/types';

const ROLE_LABEL: Record<UserRole, string> = {
  recruiter_admin: 'Recruiter / Admin',
  candidate: 'Candidate',
};

/** Written from the reader's side: what the person can do, not the enum value. */
const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  viewer: 'Viewer — read only',
  hiring_manager: 'Hiring manager — runs their own roles',
  admin: 'Admin — runs the workspace',
  owner: 'Owner — can transfer ownership',
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
  const { user: me } = useAuth();

  const [savingRole, setSavingRole] = useState<string | null>(null);
  const amOwner = me?.orgRole === 'owner';
  const canManageRoles = amOwner || me?.orgRole === 'admin';

  const [data, setData] = useState<Paginated<UserProfile> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [page, setPage] = useState(1);

  /** The person the confirm dialog is currently asking about. */
  const [pendingRemoval, setPendingRemoval] = useState<UserProfile | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);

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

  /**
   * Moves a colleague to another role.
   *
   * The server is the authority on whether this is allowed — the disabled
   * states in the table only stop the UI offering something guaranteed to
   * fail. Several rules (the last owner, a member of another workspace) can
   * only be judged there, so failures are surfaced rather than pre-empted.
   */
  const changeOrgRole = async (person: UserProfile, orgRole: OrgRole) => {
    if (person.orgRole === orgRole) return;

    setSavingRole(person.id);
    try {
      await usersApi.setOrgRole(person.id, orgRole);
      toast.success(`${person.fullName} is now ${ORG_ROLE_LABEL[orgRole]}.`);
      load();
    } catch (err) {
      toast.error(describeError(err, 'Could not change that role.'));
    } finally {
      setSavingRole(null);
    }
  };

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

  /**
   * Confirmed deletion. The server reports what it destroyed, so the
   * confirmation names real numbers rather than a guess.
   */
  const confirmRemoval = async () => {
    if (!pendingRemoval) return;

    setRemoving(true);
    try {
      const result = await usersApi.remove(pendingRemoval.id);
      const name = pendingRemoval.fullName;

      // The account survives only when another company has also invited them —
      // worth saying plainly, because "deleted" would otherwise be a lie.
      toast.success(
        result.accountDeleted
          ? `${name} deleted, along with ${result.sessions} attempt${
              result.sessions === 1 ? '' : 's'
            }.`
          : `${name}'s data deleted. Their login remains — another company has also invited them.`,
      );
      setPendingRemoval(null);

      // Deleting the last row of a page would otherwise leave the recruiter
      // staring at an empty table with a Previous button.
      if (data && data.items.length === 1 && page > 1) setPage((p) => p - 1);
      else load();
    } catch (err) {
      toast.error(describeError(err, 'Could not delete this person.'));
    } finally {
      setRemoving(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p>
            Recruiters in your organisation, and candidates you have invited.
          </p>
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
                <th style={{ width: 96 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data === null && (
                <tr>
                  <td colSpan={5} className="empty">
                    Loading…
                  </td>
                </tr>
              )}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
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

                    {/*
                     * Colleagues only — a candidate belongs to no workspace and
                     * has no role to set.
                     *
                     * The select is shown disabled rather than hidden when the
                     * viewer cannot use it: hiding it would leave someone
                     * wondering where permissions are configured, and the
                     * server refuses regardless of what the UI renders.
                     */}
                    {person.role === 'recruiter_admin' && (
                      <select
                        className="people-org-role"
                        value={person.orgRole ?? ''}
                        disabled={
                          savingRole === person.id ||
                          !canManageRoles ||
                          person.id === me?.id
                        }
                        title={
                          person.id === me?.id
                            ? 'You cannot change your own role'
                            : !canManageRoles
                              ? 'Admins and owners can change roles'
                              : undefined
                        }
                        onChange={(e) =>
                          void changeOrgRole(person, e.target.value as OrgRole)
                        }
                      >
                        {(
                          [
                            'viewer',
                            'hiring_manager',
                            'admin',
                            'owner',
                          ] as OrgRole[]
                        ).map((option) => (
                          <option
                            key={option}
                            value={option}
                            // Only an owner can hand ownership on. Offering it
                            // to an admin would produce a guaranteed 403.
                            disabled={option === 'owner' && !amOwner}
                          >
                            {ORG_ROLE_LABEL[option]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="muted">{joined(person.createdAt)}</td>
                  <td className="right">
                    {person.id === me?.id ? (
                      /* Refused server-side too; shown here so the reason is
                         obvious rather than arriving as an error. */
                      <span className="muted small">You</span>
                    ) : (
                      <button
                        className="link danger-link"
                        onClick={() => setPendingRemoval(person)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
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
        <form
          className="stack"
          style={{ gap: 12 }}
          onSubmit={(e) => void submitNew(e)}
        >
          {formError && <div className="alert error">{formError}</div>}

          <div>
            <label className="field-label" htmlFor="newName">
              Full name
            </label>
            <input
              id="newName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="John Doe"
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

      {/*
        Both roles are really deleted here; the warning differs because what is
        destroyed differs. A colleague's account goes and the company's work
        stays. A candidate's attempts, answers and reports for THIS
        organisation's assessments go, and their login goes with them unless
        another company has also invited them — that account is shared, and
        deleting it would take the other company's records too.
      */}
      <Modal
        open={pendingRemoval !== null}
        title={
          pendingRemoval?.role === 'recruiter_admin'
            ? 'Delete this colleague?'
            : 'Delete this candidate?'
        }
        onClose={() => {
          if (!removing) setPendingRemoval(null);
        }}
        footer={
          <>
            <button onClick={() => setPendingRemoval(null)} disabled={removing}>
              Cancel
            </button>
            <button
              className="danger"
              onClick={() => void confirmRemoval()}
              disabled={removing}
            >
              {removing ? 'Deleting…' : 'Delete permanently'}
            </button>
          </>
        }
      >
        {pendingRemoval && (
          <>
            <p style={{ marginTop: 0 }}>
              <strong>{pendingRemoval.fullName}</strong>{' '}
              <span className="muted">({pendingRemoval.email})</span>
            </p>

            {pendingRemoval.role === 'recruiter_admin' ? (
              <>
                <p>
                  Their account is deleted and they lose access to your
                  organisation immediately.
                </p>
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Note: This can't be undone! This user will be deleted
                  permanently and the assessments, questions they created are
                  kept. Delete them manually if you want to.
                </p>
              </>
            ) : (
              <>
                <p>
                  Everything your organisation holds about them is destroyed:
                  every attempt on your assessments, every answer, every report
                  and every proctoring log, plus their invitations.
                </p>
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Their login is deleted too, unless another company has also
                  invited them — that account is shared, and deleting it would
                  take that company's records with it. Either way you will not
                  see them here again. This cannot be undone.
                </p>
              </>
            )}
          </>
        )}
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
