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
 * Shared with the inline script in `index.html`.
 *
 * That script and this module are the only two things that read or write it,
 * and they must agree: if this key changes, the script's copy has to change in
 * the same commit or the first paint disagrees with the app that follows it.
 */
export const THEME_KEY = 'adaptivehire.theme';

interface ThemeApi {
  /** What the person chose, including `system`. */
  choice: ThemeChoice;
  /** What that resolves to right now — never `system`. */
  theme: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // Private mode, or storage disabled. The default below is a fine answer.
  }
  return 'system';
}

/** The one place the class is written, so it cannot drift between callers. */
function apply(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice);
  const [systemDark, setSystemDark] = useState(prefersDark);

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

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not persisting is a worse experience, not a broken one — the choice
      // still applies for this session.
    }
  }, []);

  const value = useMemo(
    () => ({ choice, theme, setChoice }),
    [choice, theme, setChoice],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
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
