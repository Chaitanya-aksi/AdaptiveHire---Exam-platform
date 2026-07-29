import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { setAccessToken } from './api';
import { authApi } from './endpoints';
import type { AuthUser } from './types';

interface AuthState {
  user: AuthUser | null;
  /** True until the initial silent refresh settles, so routes don't flash. */
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  /** Self-service sign-up; the created account is always a candidate. */
  register: (
    fullName: string,
    email: string,
    password: string,
  ) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** Merge fresh fields (e.g. a renamed profile) into the cached user. */
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // The access token is deliberately in memory only, so a reload starts with
  // nothing. The httpOnly refresh cookie survives, so trade it for a new
  // token before rendering — otherwise every refresh looks like a logout.
  useEffect(() => {
    let cancelled = false;

    authApi
      .refresh()
      .then(({ accessToken, user: restored }) => {
        if (cancelled) return;
        setAccessToken(accessToken);
        setUser(restored);
      })
      .catch(() => {
        // No cookie, or it has been revoked — genuinely signed out.
        if (!cancelled) setAccessToken(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken, user: signedIn } = await authApi.login(email, password);
    setAccessToken(accessToken);
    setUser(signedIn);
    return signedIn;
  }, []);

  const register = useCallback(
    async (fullName: string, email: string, password: string) => {
      const { accessToken, user: created } = await authApi.register(
        fullName,
        email,
        password,
      );
      // Registration returns the same token pair as login, so there is no
      // reason to make someone sign in again straight after signing up.
      setAccessToken(accessToken);
      setUser(created);
      return created;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Clear locally even if the call fails — the user asked to sign out.
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, updateUser }),
    [user, loading, login, register, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
