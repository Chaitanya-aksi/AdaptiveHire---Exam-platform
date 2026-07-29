import dataSource from '../src/database/data-source';
import { E2E_EMAIL_DOMAIN, E2E_QUESTION_TAGS } from './e2e.constants';

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
    const questions: { count: string }[] = await dataSource.query(
      `WITH removed AS (
         DELETE FROM questions WHERE tags && $1::text[] RETURNING 1
       ) SELECT count(*) AS count FROM removed`,
      [E2E_QUESTION_TAGS],
    );

    // Deleting the e2e users cascades their linked invitations; this sweeps any
    // still-unlinked pending invites (e.g. an invited email that never
    // registered) that carry the reserved domain.
    await dataSource.query(`DELETE FROM invitations WHERE email LIKE $1`, [
      `%@${E2E_EMAIL_DOMAIN}`,
    ]);

    const users: { count: string }[] = await dataSource.query(
      `WITH removed AS (
         DELETE FROM users WHERE email LIKE $1 RETURNING 1
       ) SELECT count(*) AS count FROM removed`,
      [`%@${E2E_EMAIL_DOMAIN}`],
    );

    const removedQuestions = Number(questions[0]?.count ?? 0);
    const removedUsers = Number(users[0]?.count ?? 0);

    if (removedQuestions > 0 || removedUsers > 0) {
      console.log(
        `\n[e2e teardown] Removed ${removedUsers} account(s) and ` +
          `${removedQuestions} question(s).`,
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
