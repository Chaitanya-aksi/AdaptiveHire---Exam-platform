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
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
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

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),

  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  // 0 disables the grace window entirely (strict single-use rotation).
  AUTH_REFRESH_GRACE_SECONDS: Joi.number().min(0).max(300).default(30),

  COOKIE_SECURE: Joi.boolean().default(false),

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
});
