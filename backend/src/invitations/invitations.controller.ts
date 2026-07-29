import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipeBuilder,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { SpreadsheetFileValidator } from '../question-bank/bulk-import/spreadsheet-file.validator';
import { parseSpreadsheet } from '../question-bank/bulk-import/spreadsheet-parser';
import { CANDIDATE_TEMPLATE_CSV } from './bulk-invite/templates';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationsService } from './invitations.service';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * No controller-level prefix: the recruiter routes hang off
 * /assessments/:id/invitations, the candidate route off /me/invitations, and
 * the template off /invitations/template. Roles are set per method.
 */
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Roles(UserRole.RECRUITER_ADMIN)
  @Post('assessments/:assessmentId/invitations/bulk-import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async bulkImport(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addValidator(new SpreadsheetFileValidator())
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    const rows = await parseSpreadsheet(file.buffer, file.originalname);
    return this.invitations.bulkInvite(assessmentId, rows, userId);
  }

  /** Add one candidate without building a spreadsheet for them. */
  @Roles(UserRole.RECRUITER_ADMIN)
  @Post('assessments/:assessmentId/invitations')
  inviteOne(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: CreateInvitationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.invitations.inviteSingle(assessmentId, dto, userId);
  }

  @Roles(UserRole.RECRUITER_ADMIN)
  @Get('assessments/:assessmentId/invitations')
  listForAssessment(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    return this.invitations.listForAssessment(assessmentId);
  }

  /**
   * Deletes an invitation added by mistake. Returns 409 once the candidate has
   * started — revoke is the operation for that.
   */
  @Roles(UserRole.RECRUITER_ADMIN)
  @Delete('invitations/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.remove(id);
  }

  /** Withdraws access while keeping the record and any completed attempt. */
  @Roles(UserRole.RECRUITER_ADMIN)
  @Patch('invitations/:id/revoke')
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.revoke(id);
  }

  /** Downloadable starter sheet so recruiters get the columns right. */
  @Roles(UserRole.RECRUITER_ADMIN)
  @Get('invitations/template')
  template(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="adaptivehire-candidates-template.csv"',
    );
    res.send(CANDIDATE_TEMPLATE_CSV);
  }

  /** The signed-in candidate's own invitations — drives their assessment list. */
  @Roles(UserRole.CANDIDATE)
  @Get('me/invitations')
  mine(@CurrentUser('id') userId: string) {
    return this.invitations.listForCandidate(userId);
  }
}
