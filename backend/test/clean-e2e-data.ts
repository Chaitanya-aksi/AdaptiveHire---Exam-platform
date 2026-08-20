import globalTeardown from './global-teardown';

/*
 * Runs the e2e sweep on its own, outside a test run.
 *
 * The same function Jest calls after the suites, invoked directly:
 *
 *   npm run e2e:clean
 *
 * Worth having as its own entry point because the sweep is a backstop, and a
 * backstop that can only run as a side effect of the thing it is backstopping
 * is no use when that thing has been failing. It is also the honest way to
 * clear debris from earlier runs without pretending a test run did it.
 *
 * Safe to run at any time: it keys off the reserved `@e2e.local` domain, the
 * `E2E Org ` name prefix and the e2e question tags, none of which a real
 * account, workspace or authored question ever carries.
 */
globalTeardown()
  .then(() => {
    console.log('[e2e clean] Done.');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('[e2e clean] Failed:', error);
    process.exit(1);
  });
