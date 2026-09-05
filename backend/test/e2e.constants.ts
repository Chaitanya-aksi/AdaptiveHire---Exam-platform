/**
 * The markers that make e2e data identifiable after the fact, so the global
 * teardown can find it without tracking ids across processes.
 *
 * Anything a suite creates must carry one of these, or it will survive the run.
 */

/** Reserved for test accounts. Never use it for a real or seeded user. */
export const E2E_EMAIL_DOMAIN = 'e2e.local';

/**
 * Key namespace for the BullMQ queues during a test run — anything but the
 * default `bull`, which is what real workers watch.
 *
 * Lives here rather than in `e2e-isolation.ts` because this file has no side
 * effects: importing it to assert on the value must not itself set the value,
 * or the guard in `helpers.ts` would pass even when `setupFiles` is missing.
 */
export const E2E_BULL_PREFIX = 'bull-e2e';

/** Any question carrying one of these tags is disposable. */
export const E2E_QUESTION_TAGS = ['e2e', 'e2e-import'];

/**
 * Every organisation a suite registers must have a name starting with this.
 *
 * Organisations were not swept before the tenancy suite existed, because no
 * suite created one — recruiters were only ever seeded. Registering a recruiter
 * creates a workspace, so a suite that does it leaves a row behind on every run
 * unless the teardown can recognise it.
 */
export const E2E_ORG_PREFIX = 'E2E Org ';
