import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

/** A spreadsheet row reduced to lowercase-keyed strings. */
export type RawRow = Record<string, string>;

const normaliseHeader = (header: string): string =>
  header.trim().toLowerCase().replace(/\s+/g, '_');

/**
 * ExcelJS exposes a cell as a primitive, a Date, or one of several wrapper
 * objects: `{ richText }`, `{ hyperlink, text }`, `{ formula, result }`,
 * `{ error }`. Anything unrecognised becomes an empty string rather than
 * "[object Object]" leaking into a question.
 *
 * `depth` guards against a self-referencing formula result.
 */
const cellToString = (value: unknown, depth = 0): string => {
  if (value === null || value === undefined || depth > 3) return '';

  if (typeof value === 'string') return value.trim();
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const cell = value as {
      richText?: { text?: unknown }[];
      text?: unknown;
      result?: unknown;
      error?: unknown;
    };

    if (Array.isArray(cell.richText)) {
      return cell.richText
        .map((run) => cellToString(run?.text, depth + 1))
        .join('')
        .trim();
    }
    if (cell.text !== undefined) return cellToString(cell.text, depth + 1);
    if (cell.result !== undefined) return cellToString(cell.result, depth + 1);
  }

  // Formula errors, symbols, functions — nothing usable.
  return '';
};

function parseCsv(buffer: Buffer): RawRow[] {
  return parse(buffer, {
    columns: (header: string[]) => header.map(normaliseHeader),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    // A short row is a missing optional column, not a reason to reject the
    // whole file — per-row validation catches anything actually required.
    relax_column_count: true,
  });
}

async function parseXlsx(buffer: Buffer): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('The workbook has no sheets');

  // ExcelJS row/col values are 1-based with a leading empty slot.
  const header = (sheet.getRow(1).values as unknown[])
    .slice(1)
    .map((h) => normaliseHeader(cellToString(h)));

  const rows: RawRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = (row.values as unknown[]).slice(1);
    const record: RawRow = {};
    header.forEach((key, i) => {
      if (key) record[key] = cellToString(values[i]);
    });
    // Skip rows that are entirely blank.
    if (Object.values(record).some((v) => v !== '')) rows.push(record);
  });

  return rows;
}

/**
 * Turns an uploaded CSV or XLSX into normalised rows. Header names are
 * lowercased and spaces become underscores, so "Question Text" and
 * "question_text" are interchangeable.
 */
export async function parseSpreadsheet(
  buffer: Buffer,
  filename: string,
): Promise<RawRow[]> {
  const ext = filename.toLowerCase().split('.').pop();

  let rows: RawRow[];
  if (ext === 'csv' || ext === 'txt') {
    rows = parseCsv(buffer);
  } else if (ext === 'xlsx' || ext === 'xlsm') {
    rows = await parseXlsx(buffer);
  } else {
    throw new BadRequestException(
      `Unsupported file type ".${ext ?? ''}" — upload a .csv or .xlsx file`,
    );
  }

  if (rows.length === 0) {
    throw new BadRequestException('The file has a header but no data rows');
  }
  return rows;
}
