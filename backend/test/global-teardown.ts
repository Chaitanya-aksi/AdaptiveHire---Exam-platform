import dataSource from '../src/database/data-source';
import {
  E2E_EMAIL_DOMAIN,
  E2E_ORG_PREFIX,
  E2E_QUESTION_TAGS,
} from './e2e.constants';

/**
 * Runs once after the whole e2e run, including when suites fail.
 *
 * Per-suite `afterAll` hooks cover the happy path, but they are skipped when a
 * suite crashes or the run is interrupted — which is how ~118 orphaned accounts
 * accumulated before this existed. A global sweep is the backstop: it keys off
 * the reserved `@e2e.local` domain and the e2e question tags rather than off ids
 * a dead process was holding, so it also clears debris from earlier runs.
 *
 * Deleting a user cascades to their invitations and sessions (and through those
 * to responses), so users can go in one statement. Questions do not cascade
 * from their author — `questions.createdById` is ON DELETE SET NULL — so the
 * tagged ones are removed explicitly.
 */
export default async function globalTeardown(): Promise<void> {
  // A failure here must not mask a genuine test failure, so nothing throws.
  try {
    await dataSource.initialize();
  } catch (error) {
    console.warn(
      `\n[e2e teardown] Could not reach the database, skipping cleanup: ${
        (error as Error).message
      }`,
    );
    return;
  }

  try {
    /*
     * Order matters, and getting it wrong is how this stopped working.
     *
     * Questions used to be deleted first. But `responses.questionId` is
     * ON DELETE RESTRICT, so the moment any e2e suite actually *answered* an
     * e2e question — which the engine suites all do — that first statement
     * threw, and because every sweep shares one try block, nothing after it
     * ran either. The result was a teardown that reported a failure and left
     * behind every account, organisation and invitation it was supposed to
     * remove: 775 users and 270 organisations by the time it was noticed.
     *
     * So the dependants go first and the questions go last, once nothing
     * references them.
     */

    // Before the users go, while the actor link still identifies them:
    // `audit_log.actorId` is ON DELETE SET NULL, so afterwards these rows are
    // anonymous and indistinguishable from real ones. Anonymous entries from
    // unauthenticated routes are left behind — nothing marks them as ours, and
    // a test database growing a few audit rows is harmless.
    await dataSource.query(
      `DELETE FROM audit_log
        WHERE "actorId" IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`%@${E2E_EMAIL_DOMAIN}`],
    );

    // Cascades sessions, and through those the responses that hold the
    // questions down. This is what has to happen before the questions can go.
    const users: { count: string }[] = await dataSource.query(
      `WITH removed AS (
         DELETE FROM users WHERE email LIKE $1 RETURNING 1
       ) SELECT count(*) AS count FROM removed`,
      [`%@${E2E_EMAIL_DOMAIN}`],
    );

    // After the users, not before. Deleting a user cascades both their sessions
    // and their linked invitations, which is most of this table's e2e rows.
    // What is left is the unlinked ones — an address invited but never
    // registered — and those have no session to block them. Run first, this
    // statement hits `assessment_sessions.invitationId`, which is
    // ON DELETE RESTRICT, and takes the whole sweep down with it.
    await dataSource.query(`DELETE FROM invitations WHERE email LIKE $1`, [
      `%@${E2E_EMAIL_DOMAIN}`,
    ]);

    // Cascades assessments, members and the organisation's own questions.
    // Sessions are the one thing an assessment does not cascade to
    // (ON DELETE RESTRICT), so they have to be gone already — they are,
    // because deleting the e2e candidates above cascaded them.
    const orgs: { count: string }[] = await dataSource.query(
      `WITH removed AS (
         DELETE FROM organisations WHERE name LIKE $1 RETURNING 1
       ) SELECT count(*) AS count FROM removed`,
      [`${E2E_ORG_PREFIX}%`],
    );

    // Last: the tagged questions that outlived their organisation, which means
    // the platform-owned ones a suite created with `organisationId` null. By
    // now nothing answers them, so the RESTRICT no longer bites.
    const questions: { count: string }[] = await dataSource.query(
      `WITH removed AS (
         DELETE FROM questions WHERE tags && $1::text[] RETURNING 1
       ) SELECT count(*) AS count FROM removed`,
      [E2E_QUESTION_TAGS],
    );

    const removedQuestions = Number(questions[0]?.count ?? 0);
    const removedUsers = Number(users[0]?.count ?? 0);
    const removedOrgs = Number(orgs[0]?.count ?? 0);

    if (removedQuestions > 0 || removedUsers > 0 || removedOrgs > 0) {
      console.log(
        `\n[e2e teardown] Removed ${removedUsers} account(s), ` +
          `${removedQuestions} question(s) and ${removedOrgs} organisation(s).`,
      );
    }
  } catch (error) {
    console.warn(
      `\n[e2e teardown] Cleanup failed: ${(error as Error).message}`,
    );
  } finally {
    await dataSource.destroy();
  }
}
