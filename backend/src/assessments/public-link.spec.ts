import {
  emailAllowedByDomain,
  generatePublicLinkToken,
  hashPublicLinkToken,
  publicLinkState,
  type PublicLinkConfig,
} from './public-link';

/**
 * These rules are the only thing between the internet and an attempt, so the
 * cases worth covering are the ones that would let somebody in who should not
 * be — a closed round, a spent cap, an expired link, the wrong domain — rather
 * than the happy path alone.
 */

const base: PublicLinkConfig = {
  publicLinkTokenHash: 'a-hash',
  publicLinkEnabled: true,
  publicLinkExpiresAt: null,
  publicLinkMaxAttempts: null,
  publicLinkEmailDomain: null,
  opensAt: null,
  closesAt: null,
};

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-10T12:00:00Z');

describe('generatePublicLinkToken', () => {
  it('mints a long random token and its hash', () => {
    const { token, hash } = generatePublicLinkToken();

    // 32 bytes base64url — comfortably past the 128 bits the proposal wanted.
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hash).toHaveLength(64);
    expect(hashPublicLinkToken(token)).toBe(hash);
  });

  it('never repeats', () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => generatePublicLinkToken().token),
    );
    expect(tokens.size).toBe(200);
  });

  it('hashes deterministically, so a lookup can find the row', () => {
    expect(hashPublicLinkToken('abc')).toBe(hashPublicLinkToken('abc'));
    expect(hashPublicLinkToken('abc')).not.toBe(hashPublicLinkToken('abd'));
  });
});

describe('publicLinkState', () => {
  it('opens when configured, enabled and unbounded', () => {
    expect(publicLinkState(base, 0, NOW)).toBe('open');
  });

  it('reports a link that was never created as not configured', () => {
    expect(
      publicLinkState({ ...base, publicLinkTokenHash: null }, 0, NOW),
    ).toBe('not_configured');
  });

  /*
   * The distinction that matters to a candidate holding a URL. "Switched off"
   * and "never existed" are different facts, and telling somebody their link is
   * invalid when the recruiter simply closed the round sends them chasing a
   * typo that is not there.
   */
  it('separates switched off from never created', () => {
    expect(publicLinkState({ ...base, publicLinkEnabled: false }, 0, NOW)).toBe(
      'disabled',
    );
  });

  it('closes once its own expiry has passed', () => {
    const expired = {
      ...base,
      publicLinkExpiresAt: at('2026-09-09T00:00:00Z'),
    };
    expect(publicLinkState(expired, 0, NOW)).toBe('expired');
  });

  /*
   * The assessment's window bounds the link whatever the link says. Without
   * this a recruiter who closed a round would have to remember to close the
   * link too, and a stale link would admit somebody to a test the runtime then
   * refuses to start — which reads to the candidate as a broken product.
   */
  it('respects the assessment window even with no expiry of its own', () => {
    expect(
      publicLinkState(
        { ...base, closesAt: at('2026-09-09T00:00:00Z') },
        0,
        NOW,
      ),
    ).toBe('expired');

    expect(
      publicLinkState({ ...base, opensAt: at('2026-09-11T00:00:00Z') }, 0, NOW),
    ).toBe('not_yet');
  });

  it('stays open inside the assessment window', () => {
    const windowed = {
      ...base,
      opensAt: at('2026-09-01T00:00:00Z'),
      closesAt: at('2026-09-30T00:00:00Z'),
    };
    expect(publicLinkState(windowed, 0, NOW)).toBe('open');
  });

  it('closes when the attempt cap is reached, not after it is passed', () => {
    const capped = { ...base, publicLinkMaxAttempts: 5 };
    expect(publicLinkState(capped, 4, NOW)).toBe('open');
    // The cap is how many the link may create, so reaching it closes the door.
    expect(publicLinkState(capped, 5, NOW)).toBe('full');
    expect(publicLinkState(capped, 6, NOW)).toBe('full');
  });

  it('ignores the cap when there is none', () => {
    expect(publicLinkState(base, 10_000, NOW)).toBe('open');
  });

  /*
   * Order is deliberate: somebody arriving at a link that was switched off is
   * told it is closed, not that it never existed.
   */
  it('reports the most informative reason when several apply', () => {
    const closed = {
      ...base,
      publicLinkEnabled: false,
      publicLinkExpiresAt: at('2026-01-01T00:00:00Z'),
      publicLinkMaxAttempts: 0,
    };
    expect(publicLinkState(closed, 99, NOW)).toBe('disabled');
  });
});

describe('emailAllowedByDomain', () => {
  it('accepts anything when no restriction is set', () => {
    expect(emailAllowedByDomain('anyone@example.com', null)).toBe(true);
  });

  it('accepts a matching domain, case-insensitively', () => {
    expect(emailAllowedByDomain('A.Student@College.EDU', 'college.edu')).toBe(
      true,
    );
  });

  it('refuses a different domain', () => {
    expect(emailAllowedByDomain('someone@gmail.com', 'college.edu')).toBe(
      false,
    );
  });

  it('accepts the restriction written with a leading @', () => {
    // Because that is how people naturally type a domain restriction.
    expect(emailAllowedByDomain('a@college.edu', '@college.edu')).toBe(true);
  });

  /*
   * The part after the LAST @, not the first. An address may legitimately carry
   * one inside a quoted local part, and splitting on the first would read
   * `"a@b"@college.edu` as belonging to `b"@college.edu` and let it through a
   * restriction it does not satisfy.
   */
  it('reads the domain from the last @, not the first', () => {
    expect(emailAllowedByDomain('"a@b"@college.edu', 'college.edu')).toBe(true);
    expect(
      emailAllowedByDomain('"a@college.edu"@evil.com', 'college.edu'),
    ).toBe(false);
  });

  it('refuses something that is not an address at all', () => {
    expect(emailAllowedByDomain('not-an-address', 'college.edu')).toBe(false);
  });

  it('tolerates surrounding whitespace on both sides', () => {
    expect(emailAllowedByDomain('a@college.edu ', ' college.edu ')).toBe(true);
  });
});
