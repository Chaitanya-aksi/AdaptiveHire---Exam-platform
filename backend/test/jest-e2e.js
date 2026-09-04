/**
 * Jest config for the e2e suites.
 *
 * JavaScript rather than JSON purely so `maxWorkers` can carry its reasoning —
 * it is the kind of setting that looks like a performance mistake and gets
 * "fixed" by the next person to read it.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.e2e-spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  globalTeardown: '<rootDir>/global-teardown.ts',

  /*
   * Serial, because every suite shares one database.
   *
   * Jest defaults to a worker per core, and parallel suites were writing to the
   * same tables mid-assertion: the percentile suite checks that an unsubmitted
   * attempt does not change the scored count, and saw the count move by four
   * because the item-analysis suite was inserting submitted attempts on the
   * same module at that moment. Neither suite was wrong.
   *
   * The alternative — a database per worker — is a lot of machinery to avoid
   * one line, and the whole e2e run is well under a minute either way.
   */
  maxWorkers: 1,

  /*
   * Jest's default is 5s, and it applies to hooks as well as tests.
   *
   * Every test in this suite finishes well inside that, but `afterAll`'s
   * `app.close()` does not always: closing a Nest app drains the TypeORM pool,
   * the ioredis client and three BullMQ workers, and under load that
   * occasionally runs past five seconds. The result was a run reporting one or
   * two failed *suites* while still reporting 196 of 196 tests passed, landing
   * on a different suite each time — which reads as a real, moving bug and is
   * not one.
   *
   * Raised rather than removed: a teardown that genuinely hangs should still
   * fail the run rather than block it forever.
   */
  testTimeout: 30_000,
};
