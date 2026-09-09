import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as Joi from 'joi';
import { envValidationSchema } from './env.validation';

/**
 * These rules only ever fire at boot, on a machine nobody is watching, so they
 * are easy to get wrong and never notice.
 *
 * The COOKIE_SAMESITE pairing in particular was first written with `.when()` on
 * the key and silently allowed every combination — `then: Joi.valid(...)` adds
 * to the values the base schema already permits rather than narrowing them. The
 * rule looked right and enforced nothing.
 */
describe('envValidationSchema', () => {
  const base = {
    POSTGRES_USER: 'u',
    POSTGRES_PASSWORD: 'p',
    POSTGRES_DB: 'd',
    JWT_ACCESS_SECRET: 'x'.repeat(20),
    JWT_REFRESH_SECRET: 'y'.repeat(20),
  };

  // Joi types `value` as `any`; narrowing it here keeps the assertions typed.
  const validate = (
    env: Record<string, string>,
  ): { error?: Joi.ValidationError; value: Record<string, unknown> } =>
    envValidationSchema.validate({ ...base, ...env });

  describe('COOKIE_SAMESITE requires COOKIE_SECURE', () => {
    it('accepts none when the cookie is also secure', () => {
      expect(
        validate({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'true' }).error,
      ).toBeUndefined();
    });

    it('refuses none without secure', () => {
      const { error } = validate({
        COOKIE_SAMESITE: 'none',
        COOKIE_SECURE: 'false',
      });
      expect(error?.message).toMatch(/requires COOKIE_SECURE=true/);
    });

    // COOKIE_SECURE defaults to false, so an unset value must be treated the
    // same as an explicit false — the check has to run after defaults apply.
    it('refuses none when secure is left unset', () => {
      const { error } = validate({ COOKIE_SAMESITE: 'none' });
      expect(error?.message).toMatch(/requires COOKIE_SECURE=true/);
    });

    it.each(['lax', 'strict'])('allows %s without secure', (sameSite) => {
      expect(
        validate({ COOKIE_SAMESITE: sameSite, COOKIE_SECURE: 'false' }).error,
      ).toBeUndefined();
    });

    it('defaults to lax', () => {
      expect(validate({}).value.COOKIE_SAMESITE).toBe('lax');
    });

    it('refuses a value that is not a SameSite policy', () => {
      expect(validate({ COOKIE_SAMESITE: 'sometimes' }).error).toBeDefined();
    });
  });

  describe('REDIS_URL', () => {
    it.each(['rediss://u:p@h.aivencloud.com:1234', 'redis://localhost:6379'])(
      'accepts %s',
      (url) => {
        expect(validate({ REDIS_URL: url }).error).toBeUndefined();
      },
    );

    // Empty is the docker compose path, where REDIS_HOST/REDIS_PORT are used.
    it('accepts an empty value', () => {
      expect(validate({ REDIS_URL: '' }).error).toBeUndefined();
    });

    it('refuses a non-Redis scheme', () => {
      expect(validate({ REDIS_URL: 'http://nope' }).error).toBeDefined();
    });
  });

  describe('POSTGRES_POOL_MAX', () => {
    // Deliberately TypeORM's own default rather than the lower value a hosted
    // deployment wants: at 5 the refresh-token e2e suite cannot drain its pool
    // inside jest's teardown window, because each refresh holds a connection
    // through an argon2 hash. The hosted value belongs in that host's env.
    it('defaults to 10', () => {
      expect(validate({}).value.POSTGRES_POOL_MAX).toBe(10);
    });

    it.each(['0', '99'])('refuses %s', (max) => {
      expect(validate({ POSTGRES_POOL_MAX: max }).error).toBeDefined();
    });
  });

  /**
   * Copying `.env.example` is the documented way to start, so every value it
   * ships has to be accepted. It shipped `LOG_LEVEL=` against a schema that
   * allowed the named levels but not an empty string, which meant a verbatim
   * copy refused to boot — and the same applies to any hosting dashboard where
   * the field is added and left blank.
   */
  it('accepts .env.example exactly as shipped', () => {
    const text = readFileSync(
      resolve(__dirname, '../../../.env.example'),
      'utf8',
    );

    const env: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) env[match[1]] = match[2];
    }

    expect(Object.keys(env).length).toBeGreaterThan(20);

    // `allowUnknown` mirrors @nestjs/config's own default: the shared root .env
    // legitimately carries VITE_* keys the backend never reads.
    const { error } = envValidationSchema.validate(env, {
      abortEarly: false,
      allowUnknown: true,
    });

    expect(error?.message).toBeUndefined();
  });
});

/**
 * The transport switch, added 2026-09-09 when Render's SMTP port block forced a
 * second way out.
 *
 * The rule that matters is the conditional one: selecting `zoho-api` without
 * its credentials must be refused at boot. Left permissive it would produce the
 * exact failure the whole transport was written to end — a mailer that looks
 * configured, reports success, and delivers nothing.
 */
describe('MAIL_TRANSPORT', () => {
  const base = {
    POSTGRES_USER: 'u',
    POSTGRES_PASSWORD: 'p',
    POSTGRES_DB: 'd',
    JWT_ACCESS_SECRET: 'x'.repeat(20),
    JWT_REFRESH_SECRET: 'y'.repeat(20),
  };
  const validate = (env: Record<string, string> = {}) =>
    envValidationSchema.validate({ ...base, ...env });

  const zohoKeys = {
    MAIL_ZOHO_CLIENT_ID: 'cid',
    MAIL_ZOHO_CLIENT_SECRET: 'secret',
    MAIL_ZOHO_REFRESH_TOKEN: 'refresh',
    MAIL_ZOHO_ACCOUNT_ID: '12345',
  };

  it('defaults to smtp, so an untouched deployment is unaffected', () => {
    const { error, value } = validate();
    expect(error).toBeUndefined();
    expect(value.MAIL_TRANSPORT).toBe('smtp');
  });

  it('needs no Zoho credentials while it stays on smtp', () => {
    expect(validate({ MAIL_TRANSPORT: 'smtp' }).error).toBeUndefined();
  });

  it('refuses zoho-api with no credentials at all', () => {
    expect(validate({ MAIL_TRANSPORT: 'zoho-api' }).error).toBeDefined();
  });

  it.each(Object.keys(zohoKeys))('refuses zoho-api missing %s', (missing) => {
    const partial = { ...zohoKeys, [missing]: '' };
    expect(
      validate({ MAIL_TRANSPORT: 'zoho-api', ...partial }).error,
    ).toBeDefined();
  });

  it('accepts zoho-api once every credential is present', () => {
    const { error, value } = validate({
      MAIL_TRANSPORT: 'zoho-api',
      ...zohoKeys,
    });
    expect(error).toBeUndefined();
    expect(value.MAIL_TRANSPORT).toBe('zoho-api');
    // The Indian data centre, because a token minted there is rejected
    // elsewhere and this workspace's mailbox lives in it.
    expect(value.MAIL_ZOHO_REGION).toBe('in');
  });

  it('rejects an unknown transport rather than guessing', () => {
    expect(validate({ MAIL_TRANSPORT: 'sendgrid' }).error).toBeDefined();
  });

  it('rejects a data centre that does not exist', () => {
    expect(
      validate({ MAIL_TRANSPORT: 'smtp', MAIL_ZOHO_REGION: 'uk' }).error,
    ).toBeDefined();
  });
});
