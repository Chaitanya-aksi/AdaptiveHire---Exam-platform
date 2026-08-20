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
};
