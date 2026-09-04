import * as Joi from 'joi';

/**
 * Fails fast at boot rather than letting a missing JWT secret turn into a
 * silently-unsigned token later.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),
  CORS_ORIGIN: Joi.string().default('http://localhost:5174'),

  // Defaults to debug in development and info in production; set explicitly to
  // turn the volume down on a noisy environment.
  //
  // Empty is allowed and means the same as unset — `configuration.ts` maps ''
  // to undefined. Without this the app refuses to boot on a verbatim copy of
  // `.env.example`, which ships the key with no value, and on any hosting
  // dashboard where the field was added and left blank.
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .allow('')
    .optional(),

  // Optional throughout: with no DSN, error tracking is simply off, so a local
  // checkout and CI need no third-party account to boot.
  SENTRY_DSN: Joi.string().allow('').default(''),
  SENTRY_RELEASE: Joi.string().allow('').default(''),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0),

  POSTGRES_HOST: Joi.string().default('localhost'),
  POSTGRES_PORT: Joi.number().default(5432),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),
  // Managed Postgres refuses plaintext connections; local compose has no
  // certificate to offer, so this stays off by default.
  POSTGRES_SSL: Joi.boolean().default(false),
  // The provider's CA, as PEM or base64 of the same. Without it the connection
  // is encrypted but the server is unauthenticated — see `configuration.ts`.
  POSTGRES_CA_CERT: Joi.string().allow('').default(''),
  // TypeORM's own default. Lower it on a hosted deployment, where free plans
  // cap connections server-side and offer no pooler — but not below about 10
  // locally: concurrent `/auth/refresh` holds a connection through an argon2
  // hash, and a small pool then cannot drain inside the e2e teardown window.
  POSTGRES_POOL_MAX: Joi.number().min(1).max(50).default(10),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  // Set by managed providers, credentials included; `rediss://` means TLS.
  // Takes precedence over REDIS_HOST/REDIS_PORT when present.
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .allow('')
    .default(''),

  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  // 0 disables the grace window entirely (strict single-use rotation).
  AUTH_REFRESH_GRACE_SECONDS: Joi.number().min(0).max(300).default(30),

  COOKIE_SECURE: Joi.boolean().default(false),

  // `none` is what a split deployment needs — the SPA and the API are then
  // different sites and the browser withholds a `lax` cookie without saying so.
  // It requires COOKIE_SECURE; that pairing is enforced below, on the object.
  COOKIE_SAMESITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),

  // True behind any PaaS proxy, so the rate limiter reads the real client
  // address instead of bucketing every candidate together.
  TRUST_PROXY: Joi.boolean().default(false),

  THROTTLE_TTL_SECONDS: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(120),

  // Frontend origin used inside invite emails.
  APP_URL: Joi.string().default('http://localhost:5174'),

  // Fallback support address for candidates whose attempt is interrupted, used
  // only where the inviting organisation has set none of its own. Optional:
  // unset means the candidate UI offers no contact route, which beats offering
  // one that goes nowhere.
  SUPPORT_EMAIL: Joi.string().email().allow('').default(''),

  // Mail is optional in dev: with no MAIL_HOST the mailer logs to the console
  // instead of sending, so the invite flow is testable without an account.
  MAIL_HOST: Joi.string().allow('').default(''),
  MAIL_PORT: Joi.number().default(587),
  MAIL_SECURE: Joi.boolean().default(false),
  MAIL_USER: Joi.string().allow('').default(''),
  MAIL_PASS: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().default('AdaptiveHire <no-reply@adaptivehire.local>'),
})
  // Every current browser drops a `SameSite=None` cookie that is not also
  // `Secure`, so the pair is refused at boot rather than found in production —
  // its symptom is the worst kind: login appears to succeed, and every session
  // dies silently at the next page load with no error anywhere.
  //
  // Checked here on the whole object rather than with `.when()` on the key,
  // because a `then: Joi.valid(...)` *adds* to the values the base schema
  // already allows instead of narrowing them — the rule silently passed
  // everything. This also runs after defaults are applied, so an unset
  // COOKIE_SECURE is correctly read as false.
  .custom((env: Record<string, unknown>, helpers) => {
    if (env.COOKIE_SAMESITE === 'none' && env.COOKIE_SECURE !== true) {
      return helpers.message({
        custom:
          'COOKIE_SAMESITE=none requires COOKIE_SECURE=true — browsers drop a ' +
          'SameSite=None cookie that is not Secure, which signs every user out ' +
          'on their next page load.',
      });
    }
    return env;
  });
