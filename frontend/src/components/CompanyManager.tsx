import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from './Toast';
import { companiesApi } from '../lib/endpoints';
import { describeError } from '../lib/errors';
import type { Company, CompanyPatch } from '../lib/types';

/*
 * The businesses inside one workspace.
 *
 * A group hires under several names from one account, and the candidate applied
 * to one of them — so this is what decides whose logo is on their invitation,
 * not the workspace's own branding above it.
 *
 * Admin-and-above, like the branding it sits under and for the same reason:
 * every field here reaches people outside the company. The server enforces it;
 * the read-only rendering below only stops a viewer being shown controls that
 * would 403.
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

const draftOf = (company: Company): Draft => ({
  name: company.name,
  logoUrl: company.logoUrl ?? '',
  accentColor: company.accentColor ?? '',
  supportEmail: company.supportEmail ?? '',
});

/**
 * One company's logo, or nothing.
 *
 * These are hot-linked from each company's own site, so a URL that has stopped
 * resolving must degrade rather than leave a broken-image glyph in a settings
 * table. Hiding it on error matches the candidate portal, which falls back to an
 * initial badge — and seeing it missing here is how somebody finds out before a
 * candidate does.
 */
function Logo({ company }: { company: Company }) {
  if (!company.logoUrl) {
    return (
      <span className="cm-mark" aria-hidden="true">
        {company.name.trim().charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className="cm-logo"
      src={company.logoUrl}
      alt=""
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
}

export function CompanyManager({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Which row is open for editing, or 'new' for the add form. */
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

  const openEdit = (company: Company) => {
    setEditing(company.id);
    setDraft(draftOf(company));
  };

  const close = () => {
    setEditing(null);
    setDraft(EMPTY);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || busy || !draft.name.trim()) return;

    const changes: CompanyPatch = {
      name: draft.name.trim(),
      logoUrl: normalise(draft.logoUrl),
      accentColor: normalise(draft.accentColor),
      supportEmail: normalise(draft.supportEmail),
    };

    setBusy(true);
    setError(null);
    try {
      if (editing === 'new') {
        const created = await companiesApi.create({
          ...changes,
          name: changes.name!,
        });
        setCompanies((current) =>
          [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
        );
        toast.success(`Added ${created.name}.`);
      } else if (editing) {
        const updated = await companiesApi.update(editing, changes);
        setCompanies((current) =>
          current.map((c) => (c.id === updated.id ? updated : c)),
        );
        toast.success(`Saved ${updated.name}.`);
      }
      close();
    } catch (err) {
      setError(describeError(err, 'Could not save that company.'));
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

  const form = (
    <form className="cm-form stack" onSubmit={(e) => void submit(e)}>
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
        <label htmlFor="cm-accent">Accent colour (optional)</label>
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
          Leave empty to inherit the workspace&rsquo;s colour above.
        </p>
      </div>

      <div className="field">
        <label htmlFor="cm-support">Support email (optional)</label>
        <input
          id="cm-support"
          type="email"
          value={draft.supportEmail}
          placeholder="careers@company.com"
          onChange={(e) =>
            setDraft({ ...draft, supportEmail: e.target.value })
          }
        />
        <p className="field-note">
          Leave empty to use the workspace address above, which is usually right
          for a group sharing one recruiting inbox.
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
          <h2>Companies</h2>
          <p className="muted small">
            The businesses you hire for. Pick one when creating an assessment
            and the candidate sees that company&rsquo;s name and logo instead of
            the workspace&rsquo;s.
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
        ) : companies.length === 0 && editing !== 'new' ? (
          <p className="muted">
            None yet. Every assessment uses the workspace branding above, which
            is right if you hire under one name. Add a company if you hire under
            several.
          </p>
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
                    <Logo company={company} />
                    <div className="cm-body">
                      <strong>{company.name}</strong>
                      <span className="muted small">
                        {company.isActive ? (
                          company.supportEmail ?? 'Workspace support address'
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
                          onClick={() => openEdit(company)}
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
          </ul>
        )}

        {editing === 'new' && form}
      </div>
    </section>
  );
}
