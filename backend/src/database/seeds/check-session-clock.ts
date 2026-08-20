import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { SessionsService } from '../../sessions/sessions.service';

/*
 * Proves the session clock starts on "Begin", not on page load.
 *
 *   npx ts-node src/database/seeds/check-session-clock.ts <assessmentId>
 *
 * Creates a throwaway candidate and invitation, starts a session, reads the
 * deadline, presses begin, reads it again — then deletes everything it made.
 * Nothing it touches belongs to a real candidate.
 *
 * The bug this exists for: `createSession` used to set the session deadline to
 * "now + the whole time budget", and `createSession` runs when the runtime
 * loads. A candidate reading the first intro screen for longer than the budget
 * had their attempt auto-submitted with zero answers before a single question
 * was served.
 */
async function main() {
  const [assessmentId] = process.argv.slice(2);
  if (!assessmentId)
    throw new Error('Usage: check-session-clock.ts <assessmentId>');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const ds = app.get(DataSource);
  const sessions = app.get(SessionsService);

  const stamp = Date.now();
  const email = `clockcheck-${stamp}@example.invalid`;
  let candidateId: string | null = null;
  let invitationId: string | null = null;

  try {
    const [candidate] = await ds.query<{ id: string }[]>(
      `INSERT INTO users ("email","fullName","passwordHash","role")
       VALUES ($1,'Clock Check','x','candidate') RETURNING id`,
      [email],
    );
    candidateId = candidate.id;

    const [invitation] = await ds.query<{ id: string }[]>(
      `INSERT INTO invitations ("assessmentId","email","status","candidateId")
       VALUES ($1,$2,'pending',$3) RETURNING id`,
      [assessmentId, email, candidateId],
    );
    invitationId = invitation.id;

    // 1. Loading the runtime. This is where the clock used to start.
    const started = await sessions.start(candidateId, invitationId);
    const sessionId = started.session.sessionId;

    const atLoad = await ds.query<{ startedAt: Date; expiresAt: Date }[]>(
      `SELECT "startedAt","expiresAt" FROM assessment_sessions WHERE id=$1`,
      [sessionId],
    );
    const loadBudgetMin = (atLoad[0].expiresAt.getTime() - Date.now()) / 60000;

    // 2. Pressing Begin, a moment later.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await sessions.startCurrentModule(candidateId, sessionId);

    const atBegin = await ds.query<{ startedAt: Date; expiresAt: Date }[]>(
      `SELECT "startedAt","expiresAt" FROM assessment_sessions WHERE id=$1`,
      [sessionId],
    );
    const beginBudgetMin =
      (atBegin[0].expiresAt.getTime() - Date.now()) / 60000;
    const rebasedMs =
      atBegin[0].startedAt.getTime() - atLoad[0].startedAt.getTime();

    console.log(
      [
        '',
        `On load   — deadline in ${loadBudgetMin.toFixed(1)} min (grace, not the budget)`,
        `On Begin  — deadline in ${beginBudgetMin.toFixed(1)} min (the real budget)`,
        `startedAt rebased forward by ${(rebasedMs / 1000).toFixed(1)}s`,
        '',
        loadBudgetMin > beginBudgetMin && rebasedMs > 0
          ? 'PASS — the budget does not start until Begin.'
          : 'FAIL — the budget was already running at load.',
      ].join('\n'),
    );
  } finally {
    // Order matters: sessions reference invitations, invitations reference the
    // candidate. Everything created above goes, whatever happened.
    if (invitationId) {
      await ds.query(
        `DELETE FROM assessment_sessions WHERE "invitationId"=$1`,
        [invitationId],
      );
      await ds.query(`DELETE FROM invitations WHERE id=$1`, [invitationId]);
    }
    if (candidateId) {
      await ds.query(`DELETE FROM users WHERE id=$1`, [candidateId]);
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
