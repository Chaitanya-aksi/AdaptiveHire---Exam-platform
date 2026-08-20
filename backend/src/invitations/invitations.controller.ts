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
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MinOrgRole } from '../common/decorators/org-roles.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgRole, UserRole } from '../common/enums';
import { SpreadsheetFileValidator } from '../question-bank/bulk-import/spreadsheet-file.validator';
import { parseSpreadsheet } from '../question-bank/bulk-import/spreadsheet-parser';
import { CANDIDATE_TEMPLATE_CSV } from './bulk-invite/templates';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { RescheduleInvitationDto } from './dto/reschedule-invitation.dto';
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
  @MinOrgRole(OrgRole.HIRING_MANAGER)
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
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    const rows = await parseSpreadsheet(file.buffer, file.originalname);
    return this.invitations.bulkInvite(
      assessmentId,
      rows,
      organisationId,
      userId,
    );
  }

  /** Add one candidate without building a spreadsheet for them. */
  @Roles(UserRole.RECRUITER_ADMIN)
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Post('assessments/:assessmentId/invitations')
  inviteOne(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: CreateInvitationDto,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.invitations.inviteSingle(
      assessmentId,
      dto,
      organisationId,
      userId,
    );
  }

  @Roles(UserRole.RECRUITER_ADMIN)
  @Get('assessments/:assessmentId/invitations')
  listForAssessment(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.invitations.listForAssessment(assessmentId, organisationId);
  }

  /**
   * Deletes an invitation added by mistake. Returns 409 once the candidate has
   * started — revoke is the operation for that.
   */
  @Roles(UserRole.RECRUITER_ADMIN)
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Delete('invitations/:id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.invitations.remove(id, organisationId);
  }

  /**
   * Moves one candidate's window without touching the round.
   *
   * For the person who was ill on the day, or joined the intake late. Sending
   * `null` for either end returns it to the assessment's own schedule.
   */
  @Roles(UserRole.RECRUITER_ADMIN)
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Patch('invitations/:id/schedule')
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleInvitationDto,
    @CurrentOrg() organisationId: string,
  ) {
    return this.invitations.reschedule(id, organisationId, dto);
  }

  /** Withdraws access while keeping the record and any completed attempt. */
  @Roles(UserRole.RECRUITER_ADMIN)
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Patch('invitations/:id/revoke')
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.invitations.revoke(id, organisationId);
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

  /**
   * One of the candidate's own invitations in full: where it is in the process
   * and how their attempt went. Participation figures only — never a score, a
   * question or a right/wrong mark. Somebody else's invitation is a 404.
   */
  @Roles(UserRole.CANDIDATE)
  @Get('me/invitations/:id')
  myAttempt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.invitations.attemptForCandidate(id, userId);
  }

  /**
   * Practice questions for one of their own invitations.
   *
   * Untimed, unscored and never part of the attempt — these come from questions
   * flagged `isSample`, which the adaptive selector and the assessment pools
   * both refuse, so nothing here can be asked for real afterwards.
   *
   * An empty array is a normal answer, not an error: it means nobody has
   * authored samples for these subjects yet, and the client skips the step.
   */
  @Roles(UserRole.CANDIDATE)
  @Get('me/invitations/:id/practice')
  myPractice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.invitations.practiceForCandidate(id, userId);
  }
}
