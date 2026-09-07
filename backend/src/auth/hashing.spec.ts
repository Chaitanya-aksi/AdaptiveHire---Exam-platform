import * as argon2 from 'argon2';
import { PASSWORD_HASH_OPTIONS, TOKEN_HASH_OPTIONS } from './hashing';

/**
 * These options are a security/performance trade, and both halves of it are
 * silent when wrong: a token hashed at password cost only shows up as latency
 * under load, and a password hashed at token cost only shows up after a breach.
 * So the properties are asserted rather than left to review.
 */
describe('hashing options', () => {
  /** argon2 encodes its parameters in the hash: `$argon2id$v=19$m=...,t=...,p=...$` */
  const paramsOf = (hash: string): string =>
    hash.split('$').slice(0, 4).join('$');

  const SAMPLE_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${'x'.repeat(180)}.signature`;

  describe('TOKEN_HASH_OPTIONS', () => {
    it('produces a hash its own token verifies against', async () => {
      const hash = await argon2.hash(SAMPLE_TOKEN, TOKEN_HASH_OPTIONS);
      await expect(argon2.verify(hash, SAMPLE_TOKEN)).resolves.toBe(true);
    });

    it('rejects a different token', async () => {
      const hash = await argon2.hash(SAMPLE_TOKEN, TOKEN_HASH_OPTIONS);
      await expect(argon2.verify(hash, `${SAMPLE_TOKEN}x`)).resolves.toBe(
        false,
      );
    });

    it('costs materially less memory than the password default', async () => {
      const token = await argon2.hash(SAMPLE_TOKEN, TOKEN_HASH_OPTIONS);
      const password = await argon2.hash(SAMPLE_TOKEN, PASSWORD_HASH_OPTIONS);

      expect(paramsOf(token)).not.toBe(paramsOf(password));
      expect(token).toContain('m=4096');
      // The whole point: the frequent operation must not carry password cost.
      expect(TOKEN_HASH_OPTIONS.memoryCost).toBeLessThan(65536);
    });
  });

  describe('PASSWORD_HASH_OPTIONS', () => {
    /*
     * `burnTime` hashes with these to stand in for a real
     * `argon2.verify(user.passwordHash, ...)`, and verify reads its parameters
     * from the stored hash. So these options have to stay whatever passwords
     * are actually hashed with — the library defaults — or the two paths take
     * visibly different times and the account-enumeration leak reopens.
     */
    it('matches the library defaults that passwords are stored with', async () => {
      const explicit = await argon2.hash(
        'correct horse battery staple',
        PASSWORD_HASH_OPTIONS,
      );
      const implicit = await argon2.hash('correct horse battery staple');

      expect(paramsOf(explicit)).toBe(paramsOf(implicit));
    });
  });

  /*
   * argon2 encodes its parameters in the hash string, so `verify` reads them
   * per-hash. This is what lets the change ship without a migration: refresh
   * tokens hashed at the old 64 MiB cost keep verifying after the switch.
   */
  it('verifies hashes made with the previous, more expensive settings', async () => {
    const legacy = await argon2.hash(SAMPLE_TOKEN); // pre-change behaviour
    await expect(argon2.verify(legacy, SAMPLE_TOKEN)).resolves.toBe(true);
  });
});
