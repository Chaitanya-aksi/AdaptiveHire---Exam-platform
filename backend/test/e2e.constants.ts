/**
 * The markers that make e2e data identifiable after the fact, so the global
 * teardown can find it without tracking ids across processes.
 *
 * Anything a suite creates must carry one of these, or it will survive the run.
 */

/** Reserved for test accounts. Never use it for a real or seeded user. */
export const E2E_EMAIL_DOMAIN = 'e2e.local';

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
