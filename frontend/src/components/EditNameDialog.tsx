import { useEffect, useId, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { usersApi } from '../lib/endpoints';
import { describeError } from '../lib/errors';
import { initials } from '../lib/initials';
import type { UserProfile } from '../lib/types';

/** Matches the `UpdateProfileDto` bounds, so the form refuses what the API would. */
const MIN_LENGTH = 2;
const MAX_LENGTH = 150;

/**
 * The counter appears only near the ceiling. A name is nowhere near 150
 * characters, so showing "6 / 150" from the first keystroke would put a limit
 * nobody is approaching in front of everybody, every time.
 */
const COUNTER_FROM = MAX_LENGTH - 20;

interface EditNameDialogProps {
  open: boolean;
  /** The name to start from, and what "unchanged" is measured against. */
  currentName: string;
  onClose: () => void;
  onSaved: (updated: UserProfile) => void;
}

/**
 * Editing your display name, behind a button rather than sitting open.
 *
 * The same reasoning as the password row beside it: an input standing
 * permanently open asks a question of everybody who came to read the page, and
 * this one asked it while showing the answer — the name was already printed
 * twice above it, on the identity card and in the top bar. A row that states
 * the name and a button that changes it says the same thing without a form.
 *
 * The dialog earns its place by previewing the part of the change that is not
 * obvious. Typing a name shows you the name; it does not show you the avatar
 * initials it produces, which is what actually appears beside you in the top
 * bar and on a report. So that is the thing the dialog draws.
 */
export function EditNameDialog({
  open,
  currentName,
  onClose,
  onSaved,
}: EditNameDialogProps) {
  const fieldId = useId();
  const formId = useId();
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Seeded on open rather than on mount, so a cancelled edit does not survive
   * to the next one — the field must always open on what is actually saved,
   * not on what somebody typed and thought better of.
   */
  useEffect(() => {
    if (!open) return;
    setName(currentName);
    setError(null);
  }, [open, currentName]);

  const trimmed = name.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_LENGTH;
  const dirty = trimmed !== currentName;
  const ready = dirty && trimmed.length >= MIN_LENGTH;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;

    setBusy(true);
    setError(null);
    try {
      onSaved(await usersApi.updateName(trimmed));
    } catch (err) {
      // In the dialog, not a toast: the field to correct is still on screen.
      setError(describeError(err, 'Could not update your name.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Edit display name"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="primary"
            disabled={!ready || busy}
          >
            {busy ? 'Saving…' : 'Save name'}
          </button>
        </>
      }
    >
      <form id={formId} className="pw-form" onSubmit={(e) => void submit(e)}>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        <div className="pw-field">
          <label htmlFor={fieldId}>Full name</label>
          <input
            id={fieldId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            autoFocus
            maxLength={MAX_LENGTH}
            aria-invalid={tooShort || undefined}
            required
          />
          <p className={`pw-note${tooShort ? ' bad' : ''}`}>
            {tooShort
              ? `At least ${MIN_LENGTH} characters.`
              : 'This is how your name appears across AdaptiveHire.'}
            {name.length >= COUNTER_FROM && (
              <span className="name-count">
                {name.length} / {MAX_LENGTH}
              </span>
            )}
          </p>
        </div>

        {/* Falls back to the saved name while the box is empty, so clearing the
            field does not flash a "?" avatar at somebody who is only about to
            type. */}
        <div className="name-preview">
          <span className="avatar" aria-hidden="true">
            {initials(trimmed || currentName)}
          </span>
          <div>
            <div className="name-preview-name">{trimmed || currentName}</div>
            <p className="pw-note">
              Your initials stand in for you in the top bar.
            </p>
          </div>
        </div>
      </form>
    </Modal>
  );
}
