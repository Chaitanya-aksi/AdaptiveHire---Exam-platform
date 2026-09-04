export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  /** Undefined lets the logger pick by environment: debug in dev, info in prod. */
  logLevel?: string;
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    /** Managed Postgres refuses plaintext; local compose has no certificate. */
    ssl: boolean;
    /**
     * The provider's CA, PEM text. Empty means "encrypt but don't verify the
     * server" — acceptable only where the network is already trusted.
     */
    caCert: string;
    /**
     * Connections this process may open.
     *
     * Defaults to TypeORM's own 10, which is what local runs and the e2e suite
     * want. A hosted deployment should lower it — free managed plans cap
     * connections server-side and offer no pooler, so 10 here plus a migration
     * run from a laptop reaches a 20-connection ceiling, where new connections
     * are refused rather than queued.
     *
     * Do not lower the *default* to buy that headroom. At 5 the refresh-token
     * suite's teardown stops fitting in jest's 5s hook timeout: every
     * `/auth/refresh` holds a connection through a 64 MiB argon2 hash, so a
     * small pool queues under concurrent auth load and the pool cannot drain.
     * That is a real property of the workload, not a test artefact — it is the
     * same contention LOAD-09 addresses by taking token hashing off the
     * password cost curve.
     */
    poolMax: number;
  };
  redis: {
    host: string;
    port: number;
    /**
     * Full connection URL, credentials included. Set by managed providers;
     * empty locally, where host and port are enough. `rediss://` means TLS.
     */
    url: string;
  };
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
    /** Seconds a just-rotated refresh token stays acceptable. */
    refreshGraceSeconds: number;
  };
  cookieSecure: boolean;
  /**
   * `none` is required when the SPA and the API are on different sites, which
   * is the normal shape of a split deployment. It only works alongside
   * `cookieSecure`, and that pairing is enforced at boot in `env.validation.ts`
   * rather than discovered when every session dies on the next page load.
   */
  cookieSameSite: 'lax' | 'strict' | 'none';
  /**
   * Trust one proxy hop for the client address. True behind any PaaS, which
   * terminates TLS in front of the app and forwards the real address in
   * `X-Forwarded-For`. Without it the rate limiter buckets everybody together.
   */
  trustProxy: boolean;
  throttle: {
    ttlSeconds: number;
    limit: number;
  };
  /** Where the frontend lives — used to build links inside invite emails. */
  appUrl: string;
  /**
   * Fallback address a candidate can write to when an assessment goes wrong,
   * used only where the inviting organisation has set none of its own.
   *
   * Null rather than a placeholder: an unset address means the UI shows no
   * contact route at all, which is better than pointing someone whose attempt
   * has just been cut short at a mailbox nobody reads.
   */
  supportEmail: string | null;
  mail: {
    /** Empty in dev: the mailer then logs messages instead of sending them. */
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
}

/**
 * Accepts the CA as raw PEM or as base64 of the same. Base64 is the form that
 * survives a hosting dashboard's env-var field, where a PEM's newlines usually
 * do not — and a CA that arrives mangled fails as an opaque TLS handshake
 * error, so it is worth accepting both and normalising here.
 */
export function readCaCert(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return '';
  if (value.includes('BEGIN CERTIFICATE')) return value;
  return Buffer.from(value, 'base64').toString('utf8');
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  logLevel: process.env.LOG_LEVEL || undefined,
  database: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    username: process.env.POSTGRES_USER ?? 'adaptivehire',
    password: process.env.POSTGRES_PASSWORD ?? 'adaptivehire',
    database: process.env.POSTGRES_DB ?? 'adaptivehire',
    ssl: process.env.POSTGRES_SSL === 'true',
    caCert: readCaCert(process.env.POSTGRES_CA_CERT),
    poolMax: parseInt(process.env.POSTGRES_POOL_MAX ?? '10', 10),
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    url: process.env.REDIS_URL ?? '',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    refreshGraceSeconds: parseInt(
      process.env.AUTH_REFRESH_GRACE_SECONDS ?? '30',
      10,
    ),
  },
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  cookieSameSite: (process.env.COOKIE_SAMESITE ?? 'lax') as
    'lax' | 'strict' | 'none',
  trustProxy: process.env.TRUST_PROXY === 'true',
  throttle: {
    ttlSeconds: parseInt(process.env.THROTTLE_TTL_SECONDS ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
  },
  appUrl: process.env.APP_URL ?? 'http://localhost:5174',
  supportEmail: process.env.SUPPORT_EMAIL?.trim() || null,
  mail: {
    host: process.env.MAIL_HOST ?? '',
    port: parseInt(process.env.MAIL_PORT ?? '587', 10),
    secure: process.env.MAIL_SECURE === 'true',
    user: process.env.MAIL_USER ?? '',
    pass: process.env.MAIL_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'AdaptiveHire <no-reply@adaptivehire.local>',
  },
});
