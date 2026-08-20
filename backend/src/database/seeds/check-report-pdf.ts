import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../../app.module';
import { ReportsService } from '../../reports/reports.service';

/*
 * Renders one report to a PDF on disk, for eyeballing the layout.
 *
 *   npx ts-node src/database/seeds/check-report-pdf.ts <sessionId> <orgId> [outDir]
 *
 * Goes through the real service, so it exercises the same org scoping, the
 * same summary/detail payloads and the same builder the download endpoint
 * uses — the only thing it skips is the HTTP response.
 */
async function main() {
  const [sessionId, organisationId, outDir = process.cwd()] =
    process.argv.slice(2);

  if (!sessionId || !organisationId) {
    throw new Error('Usage: check-report-pdf.ts <sessionId> <orgId> [outDir]');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const reports = app.get(ReportsService);
    const { filename, body } = await reports.exportReportPdf(
      sessionId,
      organisationId,
    );

    const target = path.join(outDir, filename);
    fs.writeFileSync(target, body);
    // The magic number, so a truncated or HTML error page is obvious here
    // rather than when somebody opens the file.
    const magic = body.subarray(0, 5).toString('latin1');
    console.log(`${target}  ${body.length} bytes  ${magic}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
