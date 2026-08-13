import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3002/api';

/**
 * The access token is deliberately kept in memory only. The refresh token
 * lives in an httpOnly cookie the browser attaches to /auth/* automatically —
 * neither token is ever written to localStorage.
 */
let accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const getAccessToken = (): string | null => accessToken;

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  // Required for the refresh cookie to be sent cross-origin in dev.
  withCredentials: true,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

// Collapses parallel 401s into one refresh call so a burst of requests
// doesn't rotate the refresh token several times over.
let refreshInFlight: Promise<string> | null = null;

const refreshAccessToken = (): Promise<string> => {
  refreshInFlight ??= axios
    .post<{ accessToken: string }>(
      `${BASE_URL}/auth/refresh`,
      {},
      { withCredentials: true },
    )
    .then((res) => {
      setAccessToken(res.data.accessToken);
      return res.data.accessToken;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const isAuthCall = original?.url?.includes('/auth/');

    if (error.response?.status !== 401 || !original || original._retried || isAuthCall) {
      throw error;
    }

    original._retried = true;
    try {
      await refreshAccessToken();
    } catch {
      setAccessToken(null);
      throw error;
    }
    return api.request(original);
  },
);
