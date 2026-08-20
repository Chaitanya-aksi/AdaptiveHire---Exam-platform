import { effectiveWindow, windowState } from './assessment-window';

/**
 * Window resolution.
 *
 * Worth isolating because every branch here is a way to let the wrong person
 * sit a test, or to lock out the right one — and because the inherit-vs-clear
 * distinction is the sort of rule that reads as obvious and is implemented
 * backwards half the time.
 */

const at = (iso: string) => new Date(iso);

const TUESDAY = at('2026-09-01T09:00:00Z');
const FRIDAY = at('2026-09-04T17:00:00Z');
const WEDNESDAY = at('2026-09-02T12:00:00Z');

describe('effectiveWindow', () => {
  const round = { opensAt: TUESDAY, closesAt: FRIDAY };

  it('uses the assessment’s window when the invitation sets none', () => {
    const window = effectiveWindow(round, { opensAt: null, expiresAt: null });

    expect(window.opensAt).toEqual(TUESDAY);
    expect(window.closesAt).toEqual(FRIDAY);
  });

  it('lets an invitation override one end without losing the other', () => {
    // The reschedule case: this candidate starts later, but the round's own
    // deadline still applies. Treating the null as "no bound" would silently
    // give them forever.
    const window = effectiveWindow(round, {
      opensAt: WEDNESDAY,
      expiresAt: null,
    });

    expect(window.opensAt).toEqual(WEDNESDAY);
    expect(window.closesAt).toEqual(FRIDAY);
  });

  it('lets an invitation override both ends', () => {
    const window = effectiveWindow(round, {
      opensAt: WEDNESDAY,
      expiresAt: at('2026-09-10T17:00:00Z'),
    });

    expect(window.opensAt).toEqual(WEDNESDAY);
    expect(window.closesAt).toEqual(at('2026-09-10T17:00:00Z'));
  });

  it('leaves an unscheduled assessment unbounded', () => {
    const window = effectiveWindow(
      { opensAt: null, closesAt: null },
      { opensAt: null, expiresAt: null },
    );

    expect(window.opensAt).toBeNull();
    expect(window.closesAt).toBeNull();
  });
});

describe('windowState', () => {
  it('is open when there is no window at all', () => {
    // Every assessment created before scheduling existed is this case, so it
    // has to stay sittable.
    expect(windowState({ opensAt: null, closesAt: null }, WEDNESDAY)).toBe(
      'open',
    );
  });

  it('is not yet before the opening instant', () => {
    expect(
      windowState(
        { opensAt: TUESDAY, closesAt: FRIDAY },
        at('2026-08-30T09:00:00Z'),
      ),
    ).toBe('not_yet');
  });

  it('is open inside the window', () => {
    expect(windowState({ opensAt: TUESDAY, closesAt: FRIDAY }, WEDNESDAY)).toBe(
      'open',
    );
  });

  it('is closed after the closing instant', () => {
    expect(
      windowState(
        { opensAt: TUESDAY, closesAt: FRIDAY },
        at('2026-09-05T09:00:00Z'),
      ),
    ).toBe('closed');
  });

  it('is open exactly on the opening instant', () => {
    // Somebody clicking at 09:00:00 on the dot has to get in — an off-by-one
    // here is a support ticket from the most punctual candidate in the intake.
    expect(windowState({ opensAt: TUESDAY, closesAt: FRIDAY }, TUESDAY)).toBe(
      'open',
    );
  });

  it('is open exactly on the closing instant', () => {
    expect(windowState({ opensAt: TUESDAY, closesAt: FRIDAY }, FRIDAY)).toBe(
      'open',
    );
  });

  it('treats an open-ended window as still open long after', () => {
    expect(
      windowState(
        { opensAt: TUESDAY, closesAt: null },
        at('2030-01-01T00:00:00Z'),
      ),
    ).toBe('open');
  });

  it('treats a deadline with no start as open before it', () => {
    expect(
      windowState(
        { opensAt: null, closesAt: FRIDAY },
        at('2020-01-01T00:00:00Z'),
      ),
    ).toBe('open');
  });
});
