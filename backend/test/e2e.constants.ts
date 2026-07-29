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
