import { FileValidator } from '@nestjs/common';

const ALLOWED_EXTENSIONS = ['csv', 'txt', 'xlsx', 'xlsm'];

/**
 * Validates the uploaded filename's extension rather than its MIME type.
 *
 * Nest's built-in `addFileTypeValidator` matches on `mimetype`, which is
 * unreliable here: Windows reports .csv as `application/vnd.ms-excel`, curl
 * sends `application/octet-stream`, and some browsers send `text/plain`.
 * The extension is what actually decides how we parse the file.
 */
export class SpreadsheetFileValidator extends FileValidator<
  Record<string, never>,
  Express.Multer.File
> {
  constructor() {
    super({});
  }

  isValid(file?: Express.Multer.File): boolean {
    if (!file?.originalname) return false;
    const ext = file.originalname.toLowerCase().split('.').pop() ?? '';
    return ALLOWED_EXTENSIONS.includes(ext);
  }

  buildErrorMessage(file?: Express.Multer.File): string {
    return `"${file?.originalname ?? 'file'}" is not a supported spreadsheet — upload one of: ${ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(', ')}`;
  }
}
