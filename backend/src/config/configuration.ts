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
  };
  redis: {
    host: string;
    port: number;
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
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
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
