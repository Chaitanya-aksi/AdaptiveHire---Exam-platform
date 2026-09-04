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
    it('defaults to 5, well under a free plan ceiling of 20', () => {
      expect(validate({}).value.POSTGRES_POOL_MAX).toBe(5);
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
