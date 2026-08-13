import {
  Controller,
  Get,
  ParseFilePipeBuilder,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums';
import { BulkImportService } from './bulk-import.service';
import { SpreadsheetFileValidator } from './spreadsheet-file.validator';
import { MCQ_TEMPLATE_CSV, PERSONALITY_TEMPLATE_CSV } from './templates';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Roles(UserRole.RECRUITER_ADMIN)
@Controller('questions/bulk-import')
export class BulkImportController {
  constructor(private readonly bulkImport: BulkImportService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async upload(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addValidator(new SpreadsheetFileValidator())
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.bulkImport.importFile(file.buffer, file.originalname, {
      organisationId,
      createdById: userId,
    });
  }

  /** Downloadable starter sheet so recruiters get the columns right. */
  @Get('template/mcq')
  mcqTemplate(@Res() res: Response): void {
    this.sendCsv(res, 'adaptivehire-mcq-template.csv', MCQ_TEMPLATE_CSV);
  }

  @Get('template/personality')
  personalityTemplate(@Res() res: Response): void {
    this.sendCsv(
      res,
      'adaptivehire-personality-template.csv',
      PERSONALITY_TEMPLATE_CSV,
    );
  }

  private sendCsv(res: Response, filename: string, body: string): void {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }
}
