import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { ReportsService } from '../../reports/reports.service';

/*
 * Rebuilds every stored report from the answers.
 *
 * Reports are a cache: the summary layer is computed once when a candidate
 * submits and written to `reports`, while the modules and composites beside it
 * are re-derived on read. That split is deliberate — but it means a change to
 * the scoring rules leaves the stored half stale until something regenerates
 * it, and "something" is otherwise a recruiter opening each report by hand.
 *
 * Run after any change to `report-builder.ts`, `behavioral-profiles.ts` or the
 * constants they read:
 *
 *   npx ts-node src/database/seeds/regenerate-reports.ts
 *
 * `ReportsService.generate` is unscoped by design — it is what the BullMQ
 * worker calls, and a queue job has no requesting organisation — so this walks
 * every session regardless of who owns it. That is correct here and would not
 * be from a request handler.
 *
 * Idempotent: generating a report twice produces the same rows.
 */
async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    // The per-request log lines are noise for a batch job; failures are still
    // printed below, with the session id attached.
    logger: ['error', 'warn'],
  });

  try {
    const dataSource = app.get(DataSource);
    const reports = app.get(ReportsService);

    // Only sessions that already carry a report. An in-progress attempt has
    // nothing to rebuild, and generating one for it would invent a result for
    // a test still being sat.
    const rows = await dataSource.query<{ sessionId: string }[]>(
      `SELECT DISTINCT "sessionId" FROM reports ORDER BY "sessionId"`,
    );

    console.log(`Regenerating ${rows.length} report(s)…`);

    let done = 0;
    const failures: { sessionId: string; reason: string }[] = [];

    for (const row of rows) {
      try {
        await reports.generate(row.sessionId);
        done += 1;
      } catch (error) {
        // One bad session must not abandon the rest — a report that cannot be
        // rebuilt is worth knowing about individually.
        failures.push({
          sessionId: row.sessionId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log(`✓ ${done} regenerated, ${failures.length} failed`);
    for (const failure of failures) {
      console.log(`  ✗ ${failure.sessionId}: ${failure.reason}`);
    }
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  console.error('Regeneration failed:', error);
  process.exit(1);
});
