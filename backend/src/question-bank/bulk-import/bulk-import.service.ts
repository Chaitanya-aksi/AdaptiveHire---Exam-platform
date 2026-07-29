import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuestionStatus } from '../../common/enums';
import { ModuleCatalogEntry } from '../../modules-catalog/entities/module.entity';
import { QuestionBankService } from '../question-bank.service';
import { RowError, rowToCreateDto } from './row-mapper';
import { parseSpreadsheet, type RawRow } from './spreadsheet-parser';

export interface RowFailure {
  /** 1-based spreadsheet row number, counting the header — matches Excel. */
  row: number;
  reason: string;
  questionText?: string;
}

export interface BulkImportResult {
  totalRows: number;
  imported: number;
  failed: number;
  /** Every imported question lands as `draft` for review before going live. */
  importedAs: QuestionStatus;
  failures: RowFailure[];
}

@Injectable()
export class BulkImportService {
  private readonly logger = new Logger(BulkImportService.name);

  constructor(
    @InjectRepository(ModuleCatalogEntry)
    private readonly modules: Repository<ModuleCatalogEntry>,
    private readonly questionBank: QuestionBankService,
  ) {}

  async importFile(
    buffer: Buffer,
    filename: string,
    createdById: string,
  ): Promise<BulkImportResult> {
    return this.importRows(
      await parseSpreadsheet(buffer, filename),
      createdById,
    );
  }

  /**
   * Rows are imported independently: one bad row is reported and skipped
   * rather than rolling back the whole upload. A 400-row sheet with three
   * typos should import 397 questions and tell you about the three.
   */
  async importRows(
    rows: RawRow[],
    createdById: string,
  ): Promise<BulkImportResult> {
    const moduleCache = new Map<string, ModuleCatalogEntry>();
    const failures: RowFailure[] = [];
    let imported = 0;

    for (const [index, row] of rows.entries()) {
      // +2: one for the header row, one because spreadsheets are 1-based.
      const rowNumber = index + 2;

      try {
        const slug = row.module_slug?.trim();
        if (!slug) throw new RowError('missing required column "module_slug"');

        let module = moduleCache.get(slug);
        if (!module) {
          const found = await this.modules.findOne({ where: { slug } });
          if (!found) {
            throw new RowError(
              `no module with slug "${slug}" — create it first or fix the spelling`,
            );
          }
          module = found;
          moduleCache.set(slug, found);
        }

        const dto = rowToCreateDto(row, module);
        dto.status = QuestionStatus.DRAFT;

        await this.questionBank.create(dto, createdById);
        imported += 1;
      } catch (error) {
        failures.push({
          row: rowNumber,
          reason: this.describe(error),
          questionText: row.question_text?.slice(0, 80),
        });
      }
    }

    this.logger.log(
      `Bulk import: ${imported}/${rows.length} rows imported as draft, ${failures.length} failed`,
    );

    return {
      totalRows: rows.length,
      imported,
      failed: failures.length,
      importedAs: QuestionStatus.DRAFT,
      failures,
    };
  }

  private describe(error: unknown): string {
    if (error instanceof RowError) return error.message;
    if (error instanceof BadRequestException) {
      const response = error.getResponse() as { message?: string | string[] };
      const message = response?.message ?? error.message;
      return Array.isArray(message) ? message.join('; ') : message;
    }
    if (error instanceof Error) return error.message;
    return 'unknown error';
  }
}
