import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from './Toast';
import { companiesApi, organisationsApi } from '../lib/endpoints';
import { describeError } from '../lib/errors';
import type { Company, OrganisationProfile } from '../lib/types';

/*
 * Everything a candidate sees about who is assessing them, in one list.
 *
 * This was two stacked cards — "Candidate-facing branding" for the workspace,
 * then "Companies" underneath — and they read as rivals. Both were headed with
 * a logo, an accent and a support address, neither said which one a candidate
 * would actually get, and the honest answer ("it depends on the assessment")
 * appeared nowhere. Merging them makes the precedence the structure of the
 * page rather than something to be inferred.
 *
 * The workspace row is NOT decoration and must not be dropped. It is the
 * fallback for an assessment that names no company, and it is what every
 * company inherits for any field it leaves blank — a group running one
 * recruiting inbox across six brands fills it in exactly once, here.
 *
 * Admin-and-above, because all of it reaches people outside the company. The
 * server enforces that; the read-only rendering here only avoids showing
 * controls that would 403.
 */

/** Empty means "clear it", which is how a field is unset through a text box. */
function normalise(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

interface Draft {
  name: string;
  logoUrl: string;
  accentColor: string;
  supportEmail: string;
}

const EMPTY: Draft = {
  name: '',
  logoUrl: '',
  accentColor: '',
  supportEmail: '',
};

/** The workspace row's id. Not a uuid, so it can never collide with a company. */
const WORKSPACE = 'workspace';

/**
 * One row's logo, or the initial badge the candidate portal falls back to.
 *
 * Logos are hot-linked from each company's own site, so a URL that has stopped
 * resolving must degrade rather than leave a broken-image glyph in a settings
 * table. Seeing it missing here is how somebody finds out before a candidate
 * does.
 */
function Logo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (!logoUrl) {
    return (
      <span className="cm-mark" aria-hidden="true">
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    );
  }

  return (
    <img
      className="cm-logo"
      src={logoUrl}
      alt=""
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
}

export function CompanyManager({
  canEdit,
  organisation,
  onOrganisationChange,
}: {
  canEdit: boolean;
  organisation: OrganisationProfile;
  onOrganisationChange: (next: OrganisationProfile) => void;
}) {
  const toast = useToast();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Row open for editing: a company id, `WORKSPACE`, 'new', or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    // Everything, retired included: a retired company has to be visible here in
    // order to be brought back. The assessment picker asks for active only.
    companiesApi
      .list()
      .then((rows) => {
        if (!cancelled) setCompanies(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(describeError(err, 'Could not load your companies.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const openNew = () => {
    setEditing('new');
    setDraft(EMPTY);
  };

  const openCompany = (company: Company) => {
    setEditing(company.id);
    setDraft({
      name: company.name,
      logoUrl: company.logoUrl ?? '',
      accentColor: company.accentColor ?? '',
      supportEmail: company.supportEmail ?? '',
    });
  };

  const openWorkspace = () => {
    setEditing(WORKSPACE);
    setDraft({
      // The workspace name is set at registration and is not editable here, so
      // the form hides the field rather than offering one that goes nowhere.
      name: organisation.name,
      logoUrl: organisation.logoUrl ?? '',
      accentColor: organisation.accentColor ?? '',
      supportEmail: organisation.supportEmail ?? '',
    });
  };

  const close = () => {
    setEditing(null);
    setDraft(EMPTY);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || busy) return;
    if (editing !== WORKSPACE && !draft.name.trim()) return;

    const shared = {
      logoUrl: normalise(draft.logoUrl),
      accentColor: normalise(draft.accentColor),
      supportEmail: normalise(draft.supportEmail),
    };

    setBusy(true);
    setError(null);
    try {
      if (editing === WORKSPACE) {
        // Different endpoint, same three fields — the workspace is an
        // organisation row, not a company, and only its branding is editable.
        onOrganisationChange(await organisationsApi.updateBranding(shared));
        toast.success('Saved. Candidates see this where no company is set.');
      } else if (editing === 'new') {
        const created = await companiesApi.create({
          ...shared,
          name: draft.name.trim(),
        });
        setCompanies((current) =>
          [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
        );
        toast.success(`Added ${created.name}.`);
      } else if (editing) {
        const updated = await companiesApi.update(editing, {
          ...shared,
          name: draft.name.trim(),
        });
        setCompanies((current) =>
          current.map((c) => (c.id === updated.id ? updated : c)),
        );
        toast.success(`Saved ${updated.name}.`);
      }
      close();
    } catch (err) {
      setError(describeError(err, 'Could not save that.'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Retiring, not deleting.
   *
   * A retired company keeps its place on every round and report that already
   * names it — the candidate who sat one applied to *that* business, and
   * rewriting their record to the parent's name years later would falsify it.
   * It simply stops being offered for new assessments.
   */
  const setActive = async (company: Company, isActive: boolean) => {
    if (!canEdit || busy) return;

    setBusy(true);
    setError(null);
    try {
      const updated = await companiesApi.update(company.id, { isActive });
      setCompanies((current) =>
        current.map((c) => (c.id === updated.id ? updated : c)),
      );
      toast.success(
        isActive ? `${updated.name} is back.` : `${updated.name} retired.`,
      );
    } catch (err) {
      setError(describeError(err, 'Could not change that company.'));
    } finally {
      setBusy(false);
    }
  };

  const isWorkspaceForm = editing === WORKSPACE;

  const form = (
    <form className="cm-form stack" onSubmit={(e) => void submit(e)}>
      {/* No name field on the workspace: it is set when the company registers,
          and an input that silently does nothing is worse than no input. */}
      {!isWorkspaceForm && (
        <div className="field">
          <label htmlFor="cm-name">Company name</label>
          <input
            id="cm-name"
            value={draft.name}
            maxLength={200}
            required
            placeholder="KhetPilot"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <p className="field-note">
            As a candidate should see it, not the registered legal name.
          </p>
        </div>
      )}

      <div className="field">
        <label htmlFor="cm-logo">Logo URL</label>
        <input
          id="cm-logo"
          type="url"
          value={draft.logoUrl}
          placeholder="https://cdn.example.com/logo.png"
          onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })}
        />
        <p className="field-note">
          Must be https, or it is blocked as mixed content and never appears.
          Prefer a URL on a domain you control: a link to someone else&rsquo;s
          CDN can expire without warning, and the logo then quietly disappears.
        </p>
      </div>

      <div className="field">
        <label htmlFor="cm-accent">Accent colour</label>
        <div className="set-colour">
          <input
            id="cm-accent"
            type="text"
            value={draft.accentColor}
            placeholder="#2f5bea"
            onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
          />
          <input
            type="color"
            aria-label="Pick accent colour"
            value={
              /^#[0-9a-fA-F]{6}$/.test(draft.accentColor)
                ? draft.accentColor
                : '#2f5bea'
            }
            onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
          />
        </div>
        <p className="field-note">
          {isWorkspaceForm
            ? "Leave empty for AdaptiveHire's own."
            : 'Leave empty to inherit the default below.'}
        </p>
      </div>

      <div className="field">
        <label htmlFor="cm-support">Support email for candidates</label>
        <input
          id="cm-support"
          type="email"
          value={draft.supportEmail}
          placeholder="hiring@yourcompany.com"
          onChange={(e) => setDraft({ ...draft, supportEmail: e.target.value })}
        />
        <p className="field-note">
          {isWorkspaceForm
            ? 'Shown to a candidate whose assessment was interrupted, by a power cut or a dropped connection, so they can tell you what happened. The clock keeps running whether or not their browser is open, so this is the only way they can reach you. Leave empty and they are shown no contact route at all.'
            : 'Leave empty to use the default address below, which is usually right for a group sharing one recruiting inbox.'}
        </p>
      </div>

      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : editing === 'new' ? 'Add company' : 'Save'}
        </button>
        <button type="button" className="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <section className="card set-card">
      <div className="card-head">
        <div>
          <h2>Candidate-facing branding</h2>
          {/* The precedence rule, stated once, before the list that embodies
              it. Without this the two halves read as rival settings. */}
          <p className="muted small">
            An assessment names the business it is for, and the candidate sees
            that business. Anything it leaves blank falls back to the default at
            the bottom.
          </p>
        </div>
        {canEdit && editing !== 'new' && (
          <button type="button" className="button" onClick={openNew}>
            Add company
          </button>
        )}
      </div>

      <div className="card-pad stack">
        {error && <div className="alert error">{error}</div>}

        {loading ? (
          <div className="ci-skeleton" style={{ height: 90 }} />
        ) : (
          <ul className="cm-list">
            {companies.map((company) => (
              <li
                key={company.id}
                className={`cm-row${company.isActive ? '' : ' cm-row--retired'}`}
              >
                {editing === company.id ? (
                  form
                ) : (
                  <>
                    <Logo name={company.name} logoUrl={company.logoUrl} />
                    <div className="cm-body">
                      <strong>{company.name}</strong>
                      <span className="muted small">
                        {company.isActive ? (
                          (company.supportEmail ?? 'Uses the default address')
                        ) : (
                          <em>
                            Retired — stays on existing rounds, not offered for
                            new ones
                          </em>
                        )}
                      </span>
                    </div>
                    {canEdit && (
                      <div className="cm-actions">
                        <button
                          type="button"
                          className="button"
                          onClick={() => openCompany(company)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void setActive(company, !company.isActive)
                          }
                        >
                          {company.isActive ? 'Retire' : 'Restore'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}

            {editing === 'new' && <li className="cm-row">{form}</li>}

            {/*
             * The workspace, last and labelled as the fallback.
             *
             * Last because it is the least-touched row: a group fills it in
             * once and then works in the companies above it. Kept visible
             * because it is what an assessment with no company shows, and what
             * every blank field above inherits — and because a fallback nobody
             * can see is one nobody knows is being used.
             *
             * No Retire button. There is no version of this product where the
             * workspace has no branding at all.
             */}
            <li className="cm-row cm-row--default">
              {editing === WORKSPACE ? (
                form
              ) : (
                <>
                  <Logo
                    name={organisation.name}
                    logoUrl={organisation.logoUrl}
                  />
                  <div className="cm-body">
                    <strong>
                      {organisation.name}
                      <span className="cm-tag">Default</span>
                    </strong>
                    <span className="muted small">
                      {companies.length === 0
                        ? 'What every candidate sees. Add a company above to override it per assessment.'
                        : 'Used when an assessment names no company, and inherited by any field left blank above.'}
                    </span>
                  </div>
                  {canEdit && (
                    <div className="cm-actions">
                      <button
                        type="button"
                        className="button"
                        onClick={openWorkspace}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          </ul>
        )}
      </div>
    </section>
  );
}
