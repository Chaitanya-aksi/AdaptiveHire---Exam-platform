import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/*
 * Light, dark, or whatever the operating system says.
 *
 * Three stored states, two rendered ones. `system` is the default for somebody
 * who has never chosen, and it is a *stored* value in its own right rather than
 * the absence of one — so a person who picks dark, then changes their mind and
 * picks system, gets system rather than being stuck on their old choice.
 *
 * The resolved answer lands on `<html>` as a single `dark` class. The
 * stylesheet therefore only ever sees two states, and no rule has to be
 * written twice or guarded by a media query that an explicit choice cannot
 * beat.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/**
 * The **mirror** key: whatever theme is in effect right now, whoever is signed
 * in. Shared with the inline script in `index.html`.
 *
 * That script and this module are the only two things that read or write it,
 * and they must agree: if this key changes, the script's copy has to change in
 * the same commit or the first paint disagrees with the app that follows it.
 *
 * It exists *because* the script cannot know who is signed in — the access
 * token lives in memory and is traded for on boot, long after the first paint.
 * So the per-account choice below is copied here whenever it changes, and the
 * script reads this one. Without it the cold load would paint the app default
 * and then flip to the person's real theme once auth resolved, which is the
 * white flash the script exists to prevent.
 */
export const THEME_KEY = 'adaptivehire.theme';

/**
 * Where one account's own choice is kept.
 *
 * `localStorage` is scoped to the origin, not to the person, so a single key
 * made the theme a property of the browser: on any shared machine — a demo
 * laptop, a candidate kiosk, a recruiter checking what their candidates see —
 * whoever toggled it last had toggled it for everybody who signed in
 * afterwards. Keying on the user id makes the preference theirs.
 *
 * Signed-out visitors get their own bucket rather than borrowing the last
 * occupant's: the sign-in page is the one screen every account shares.
 */
const GUEST_KEY = `${THEME_KEY}.guest`;
const keyFor = (userId: string | null): string =>
  userId ? `${THEME_KEY}.user.${userId}` : GUEST_KEY;

interface ThemeApi {
  /** What the person chose, including `system`. */
  choice: ThemeChoice;
  /** What that resolves to right now — never `system`. */
  theme: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
}

/**
 * Tells the provider whose preference to load. Kept separate from `ThemeApi`
 * so the toggle cannot reach it — only the bridge in `App` sets an identity.
 */
interface ThemeIdentityApi {
  setIdentity: (userId: string | null, known: boolean) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);
const ThemeIdentityContext = createContext<ThemeIdentityApi | null>(null);

const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

function isChoice(value: string | null): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** One account's stored choice, or null when they have never picked one. */
function readStored(key: string): ThemeChoice | null {
  try {
    const stored = localStorage.getItem(key);
    return isChoice(stored) ? stored : null;
  } catch {
    // Private mode, or storage disabled. Callers treat this as "no choice".
    return null;
  }
}

/** What the last paint used — the starting point before we know the account. */
function readMirror(): ThemeChoice {
  return readStored(THEME_KEY) ?? 'system';
}

function write(key: string, choice: ThemeChoice): void {
  try {
    localStorage.setItem(key, choice);
    // Always mirrored, so the next cold load paints this and not the theme of
    // whoever used the browser before.
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Not persisting is a worse experience, not a broken one — the choice
    // still applies for this session.
  }
}

/** The one place the class is written, so it cannot drift between callers. */
function apply(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  /*
   * Starts from the mirror, not from a per-account key, because on the very
   * first render nobody knows who is signed in yet — the refresh cookie is
   * still being traded for a token. The mirror is what the inline script
   * painted, so starting anywhere else would guarantee a flip.
   */
  const [choice, setChoiceState] = useState<ThemeChoice>(readMirror);
  const [systemDark, setSystemDark] = useState(prefersDark);

  /**
   * Whose preference is loaded. `null` is the signed-out bucket, which is a
   * real identity here rather than "unknown" — see `identityKnown`.
   */
  const [identity, setIdentityState] = useState<string | null>(null);
  const [identityKnown, setIdentityKnown] = useState(false);

  /*
   * Follows the OS while the choice is `system`.
   *
   * The listener is registered regardless, because the candidate may switch to
   * `system` later and a listener added only in that branch would miss the
   * change that happens next. Reacting is cheap; missing it is a stale theme.
   */
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const theme: ResolvedTheme =
    choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  // Kept in sync rather than applied once: the class is already correct on
  // first paint thanks to the inline script, and this keeps it correct after
  // a toggle or an OS change without a reload.
  useEffect(() => apply(theme), [theme]);

  /*
   * Loads the signed-in account's own preference, and does nothing until there
   * is an account to load one for.
   *
   * The `known` guard is what keeps the boot quiet. `useAuth` reports
   * `user: null` while the silent refresh is still in flight, which is
   * indistinguishable from being signed out — acting on it would swap a
   * recruiter's dark theme for the guest default for as long as the request
   * takes, then swap it back.
   *
   * An account with no stored choice gets `system`, deliberately, rather than
   * inheriting whatever is on screen. Inheriting is how the preference leaked
   * between people in the first place, and `system` is the app's honest default
   * for somebody who has never expressed one.
   */
  useEffect(() => {
    if (!identityKnown) return;
    const next = readStored(keyFor(identity)) ?? 'system';
    setChoiceState(next);
    write(keyFor(identity), next);
  }, [identity, identityKnown]);

  const setChoice = useCallback(
    (next: ThemeChoice) => {
      setChoiceState(next);
      write(keyFor(identity), next);
    },
    [identity],
  );

  /*
   * Idempotent on purpose: the bridge calls this on every auth render, and a
   * `setState` to an equal value would otherwise re-run the loader above and
   * stamp `system` over a choice the person had just made.
   */
  const setIdentity = useCallback((userId: string | null, known: boolean) => {
    setIdentityState((current) => (current === userId ? current : userId));
    setIdentityKnown((current) => (current === known ? current : known));
  }, []);

  const value = useMemo(
    () => ({ choice, theme, setChoice }),
    [choice, theme, setChoice],
  );
  const identityValue = useMemo(() => ({ setIdentity }), [setIdentity]);

  return (
    <ThemeIdentityContext.Provider value={identityValue}>
      <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    </ThemeIdentityContext.Provider>
  );
}

/**
 * Binds the signed-in account to the theme provider.
 *
 * A bridge rather than a direct `useAuth()` call inside `ThemeProvider`,
 * because the provider sits above `AuthProvider` — the sign-in and reset pages
 * are themed too, and they render outside the authenticated tree. Rendering a
 * one-line component inside the auth tree is what carries the identity up
 * without reordering the providers.
 */
export function ThemeIdentityBridge({
  userId,
  known,
}: {
  userId: string | null;
  known: boolean;
}) {
  const context = useContext(ThemeIdentityContext);
  const setIdentity = context?.setIdentity;

  useEffect(() => {
    setIdentity?.(userId, known);
  }, [setIdentity, userId, known]);

  return null;
}

/**
 * The current theme, for the rare component that needs the value rather than
 * the CSS — a canvas, a chart library, anything that takes colours as
 * arguments instead of inheriting them.
 */
export function useTheme(): ThemeApi {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return context;
}
