import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { IconEye, IconEyeOff } from './Icons';
import { Modal } from './Modal';
import { usersApi } from '../lib/endpoints';
import { describeError } from '../lib/errors';

/**
 * The only rule the server actually enforces (`ChangePasswordDto`). Everything
 * else on this form is guidance, and is worded so it cannot be mistaken for a
 * requirement — a checklist that refuses to tick for a rule nobody checks is a
 * form that appears broken.
 */
const MIN_LENGTH = 8;

/** Strength labels, indexed by the score `strengthOf` returns. */
const STRENGTH = [
  { label: 'Too short', tone: 'none' },
  { label: 'Weak', tone: 'weak' },
  { label: 'Fair', tone: 'fair' },
  { label: 'Good', tone: 'good' },
  { label: 'Strong', tone: 'strong' },
] as const;

/**
 * A rough 0-4 score: length first, then variety.
 *
 * Deliberately not zxcvbn. That library is ~400KB to tell somebody their
 * password is weak, and this meter changes nothing about what is accepted — the
 * server takes any eight characters. It is a nudge, so it is scored here in a
 * dozen lines and labelled as advice.
 *
 * Length is weighted hardest because it is the property that actually resists
 * an offline guess; a twelve-character phrase beats `P@ss1` and any meter
 * saying otherwise is teaching the wrong lesson.
 */
function strengthOf(password: string): number {
  if (password.length < MIN_LENGTH) return 0;

  let score = 1;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;

  const variety =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/\d/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password));
  if (variety >= 3) score++;

  return Math.min(score, 4);
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  invalid?: boolean;
  /**
   * What the toggle calls this field, when the label does not survive being
   * dropped into "Show …". Three buttons on one form need three distinct
   * names, so this stays specific rather than falling back to "Show password"
   * — but "Show confirm new password" is not English.
   */
  revealName?: string;
  children?: ReactNode;
}

/**
 * A password input with its own show/hide control.
 *
 * The toggle is `tabIndex={-1}` on purpose: someone tabbing from the field to
 * the next one wants the next field, not a button that reveals what they just
 * typed to whoever is behind them. It stays reachable by mouse and by screen
 * reader, which is who it is for.
 */
function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  invalid,
  revealName,
  children,
}: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const name = revealName ?? label.toLowerCase();

  return (
    <div className="pw-field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-input-wrap">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        />
        <button
          type="button"
          className="pw-toggle"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? `Hide ${name}` : `Show ${name}`}
          tabIndex={-1}
        >
          {shown ? (
            <IconEye width={17} height={17} />
          ) : (
            <IconEyeOff width={17} height={17} />
          )}
        </button>
      </div>
      {children}
    </div>
  );
}

interface ChangePasswordDialogProps {
  open: boolean;
  /** The signed-in account this applies to. Shown, never asked for — see below. */
  email: string;
  onClose: () => void;
  onChanged: () => void;
}

/**
 * Changing your own password, behind a button rather than sitting open.
 *
 * The three fields used to be permanently on the account page, which put an
 * empty form in front of everyone who came to read their name or their role —
 * most visits — and gave the page's most destructive action its most prominent
 * position. Production settings pages (GitHub, Stripe, Google) all do the same
 * thing instead: a row that states the account has a password, and a button
 * that opens the form when you actually want it.
 *
 * **The email is shown, not asked for.** You are already signed in, and the
 * endpoint takes the account from the access token — there is no field for it
 * in `ChangePasswordDto` and there should not be, because an address you can
 * type is an address you can type *someone else's* into. What the email is for
 * is the browser's password manager, which needs a `username` beside a
 * `new-password` to file the update under the right entry; that is the hidden
 * input below, and it is the same trick every production form uses.
 */
export function ChangePasswordDialog({
  open,
  email,
  onClose,
  onChanged,
}: ChangePasswordDialogProps) {
  const formId = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Cleared on open, not on close.
   *
   * Clearing on the way out would wipe the fields during the dialog's exit
   * animation, so a cancelled form visibly empties itself as it goes. Doing it
   * on the way in is invisible and gives the same guarantee: typed passwords
   * never survive to a second opening.
   */
  useEffect(() => {
    if (!open) return;
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
  }, [open]);

  const longEnough = next.length >= MIN_LENGTH;
  const matches = confirm.length > 0 && next === confirm;
  const mismatch = confirm.length > 0 && next !== confirm;
  /*
   * The server does not refuse this — it would happily re-hash the same
   * password — but a "change" that changes nothing is never what someone meant,
   * and letting it through would report success for it.
   */
  const unchanged = longEnough && current.length > 0 && next === current;
  const ready = current.length > 0 && longEnough && matches && !unchanged;

  const strength = strengthOf(next);
  const meter = STRENGTH[strength];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;

    setBusy(true);
    setError(null);
    try {
      await usersApi.changePassword(current, next);
      onChanged();
    } catch (err) {
      /*
       * Kept in the dialog rather than raised as a toast. A wrong current
       * password is a correction to make in a field that is still on screen,
       * and a message that floats in a corner and times out is the wrong shape
       * for that. Success is the toast, because by then this is gone.
       */
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      setError(
        status === 401
          ? 'That is not your current password. Check it and try again.'
          : describeError(err, 'Could not change your password.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Change password"
      // Ignored while saving: the request is in flight and closing would leave
      // the caller unable to say whether it landed.
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
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </>
      }
    >
      <form id={formId} className="pw-form" onSubmit={(e) => void submit(e)}>
        <p className="pw-account">
          Updating the password for <strong>{email}</strong>.
        </p>

        {/* For password managers only: a `new-password` with no `username`
            beside it gets filed under the wrong entry, or under none. Hidden
            rather than shown as a disabled box, which would read as a field
            somebody had failed to fill in. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={email}
          readOnly
          hidden
        />

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        <PasswordField
          id={`${formId}-current`}
          label="Current password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          autoFocus
        />

        <PasswordField
          id={`${formId}-new`}
          label="New password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          invalid={unchanged}
        >
          {/* The meter appears only once there is something to measure —
              a bar sitting at zero under an empty field is a judgement on
              nothing. */}
          {next.length > 0 && (
            <div className="pw-meter" aria-hidden="true">
              <div className={`pw-meter-track pw-meter--${meter.tone}`}>
                {[1, 2, 3, 4].map((step) => (
                  <span key={step} className={step <= strength ? 'on' : ''} />
                ))}
              </div>
              <span className="pw-meter-label">{meter.label}</span>
            </div>
          )}

          <p className={`pw-note${next.length > 0 && !longEnough ? ' bad' : ''}`}>
            {unchanged
              ? 'This is the password you already have — choose a different one.'
              : `At least ${MIN_LENGTH} characters. Length beats punctuation: a few
                 unrelated words are stronger than a short password with symbols
                 in it.`}
          </p>
        </PasswordField>

        <PasswordField
          id={`${formId}-confirm`}
          label="Confirm new password"
          revealName="the confirmed password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          invalid={mismatch}
        >
          {mismatch && <p className="pw-note bad">These two do not match yet.</p>}
          {matches && !unchanged && (
            <p className="pw-note good">Both entries match.</p>
          )}
        </PasswordField>

        <p className="pw-after">
          You will stay signed in here and everywhere else you are already
          signed in.
        </p>
      </form>
    </Modal>
  );
}
