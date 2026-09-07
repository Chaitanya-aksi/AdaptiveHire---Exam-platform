import * as argon2 from 'argon2';

/**
 * The two hashing jobs in this system, which are not the same job.
 *
 * Both were using argon2's defaults — 64 MiB of memory per call. That is the
 * right price for a password and the wrong one for a refresh token, and the
 * difference matters because token rotation is the most frequent authenticated
 * operation in the product: every active candidate, every fifteen minutes,
 * while holding a database connection for the duration.
 *
 * Measured on the deployed instance (0.1 CPU): a request that hashes at the
 * default cost takes ~1.7s against ~0.23s for one that does not. Twenty
 * candidates refreshing at once is then ~30 seconds of serialised CPU work
 * against a five-connection pool — which is the same contention that made the
 * e2e teardown miss its five-second window at `POSTGRES_POOL_MAX=5`.
 */

/**
 * Passwords keep the library defaults.
 *
 * A password is human-chosen and therefore guessable from a dictionary, so the
 * hash has to stay expensive: that cost is the entire defence if the database
 * leaks. Deliberately `{}` rather than pinned numbers — the library's defaults
 * track current guidance, and freezing them here would quietly opt out of that.
 */
export const PASSWORD_HASH_OPTIONS: argon2.HashOptions = {};

/**
 * Refresh tokens are cheap to hash, because there is nothing to grind.
 *
 * A refresh token is a signed JWT carrying a random `jti` (see `issueTokens`) —
 * machine-generated, high-entropy, and unforgeable without the signing secret.
 * There is no dictionary for an attacker to work through, so memory-hard
 * parameters buy nothing here while costing the most frequent operation in the
 * system. The hash at rest exists so a leaked database does not hand out live
 * sessions, not to resist a guessing attack that cannot get started.
 */
export const TOKEN_HASH_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 4096, // 4 MiB, down from the default 64 MiB
  timeCost: 2,
  parallelism: 1,
};
