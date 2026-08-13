import { NestFactory } from '@nestjs/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../../app.module';
import { QuestionStatus, UserRole } from '../../common/enums';
import { BulkImportService } from '../../question-bank/bulk-import/bulk-import.service';
import { Question } from '../../question-bank/entities/question.entity';
import { User } from '../../users/entities/user.entity';
import { DataSource } from 'typeorm';

const FIXTURE_DIR = join(
  __dirname,
  '..',
  '..',
  'question-bank',
  'bulk-import',
  'fixtures',
);

/**
 * Loads the fixture question bank.
 *
 * These are SYNTHETIC questions written to exercise the adaptive engine, not
 * curated assessment content — every row is tagged `fixture` so it can be
 * found and removed once real content is imported:
 *
 *   DELETE FROM questions WHERE 'fixture' = ANY(tags);
 *
 * It deliberately runs through BulkImportService, the same path an uploaded
 * spreadsheet takes, so seeding also proves the importer works.
 */
async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const dataSource = app.get(DataSource);
    const bulkImport = app.get(BulkImportService);

    const author = await dataSource.getRepository(User).findOne({
      where: { role: UserRole.RECRUITER_ADMIN },
      order: { createdAt: 'ASC' },
    });
    if (!author) {
      throw new Error(
        'No recruiter_admin found — run `npm run seed:users` first',
      );
    }

    // Adding one new fixture file to a bank that already has content. Skips
    // both the reload guard and the delete, because the intent is to append
    // rather than replace — SEED_FORCE cannot do this, since it would try to
    // delete questions candidates have already answered.
    //
    //   SEED_ONLY=personality-behavioral.csv npm run seed:questions
    const only = process.env.SEED_ONLY?.split(',')
      .map((name) => name.trim())
      .filter(Boolean);

    // Unlike the user and module seeds there is no natural unique key to skip
    // on, so re-running would silently double the bank. Guard on the tag.
    const questions = dataSource.getRepository(Question);
    const existing = await questions
      .createQueryBuilder('q')
      .where("'fixture' = ANY(q.tags)")
      .getCount();

    if (!only && existing > 0 && process.env.SEED_FORCE !== 'true') {
      console.log(
        `${existing} fixture questions already loaded — nothing to do.\n` +
          'To reload them, either:\n' +
          '  SEED_FORCE=true npm run seed:questions   (deletes and re-imports)\n' +
          "  or remove them first: DELETE FROM questions WHERE 'fixture' = ANY(tags);",
      );
      return;
    }

    if (!only && existing > 0) {
      // Fails loudly if a candidate has already answered one of these —
      // `responses` references questions with ON DELETE RESTRICT.
      const removed = await questions
        .createQueryBuilder()
        .delete()
        .where("'fixture' = ANY(tags)")
        .execute();
      console.log(
        `SEED_FORCE: removed ${removed.affected ?? 0} fixture questions\n`,
      );
    }

    const files = readdirSync(FIXTURE_DIR)
      .filter((f) => f.endsWith('.csv'))
      .filter((f) => !only || only.includes(f));

    if (only && files.length === 0) {
      throw new Error(
        `SEED_ONLY matched no fixture files. Available: ${readdirSync(
          FIXTURE_DIR,
        )
          .filter((f) => f.endsWith('.csv'))
          .join(', ')}`,
      );
    }
    let totalImported = 0;
    let totalFailed = 0;

    for (const file of files) {
      const buffer = readFileSync(join(FIXTURE_DIR, file));
      // organisationId null: the fixtures are the platform's starter bank, so
      // every organisation can use them and none can edit them.
      const result = await bulkImport.importFile(buffer, file, {
        organisationId: null,
        createdById: author.id,
      });

      totalImported += result.imported;
      totalFailed += result.failed;

      console.log(
        `${file.padEnd(26)} ${String(result.imported).padStart(3)} imported, ${result.failed} failed`,
      );
      for (const failure of result.failures) {
        console.log(`    row ${failure.row}: ${failure.reason}`);
      }
    }

    // The importer lands everything as draft for human review. Fixtures are
    // self-authored and exist to be used, so activate them here — the one
    // place where skipping review is correct.
    const activated = await dataSource
      .getRepository(Question)
      .createQueryBuilder()
      .update()
      .set({ status: QuestionStatus.ACTIVE })
      .where("'fixture' = ANY(tags)")
      .andWhere('status = :draft', { draft: QuestionStatus.DRAFT })
      .execute();

    console.log(
      `\n${totalImported} imported, ${totalFailed} failed, ${activated.affected ?? 0} activated`,
    );

    if (totalFailed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  console.error('Question seeding failed:', error);
  process.exit(1);
});
