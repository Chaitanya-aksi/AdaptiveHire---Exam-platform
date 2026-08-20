import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MinOrgRole } from '../common/decorators/org-roles.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgRole, UserRole } from '../common/enums';
import { ExportCohortDto } from './dto/export-cohort.dto';
import { SaveReviewDto } from './dto/save-review.dto';
import { SendCandidateMessageDto } from './dto/send-message.dto';
import { ReportsService } from './reports.service';

/**
 * Reports are recruiter-only, in full. A candidate never sees their score,
 * their trait profile or which answers were wrong — the whole point of the
 * report is to inform a hiring decision, and exposing it would also hand out
 * the answer key.
 */
@Roles(UserRole.RECRUITER_ADMIN)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Every attempt at one assessment — the way in to an individual report. */
  @Get('assessments/:assessmentId')
  listForAssessment(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.reports.listForAssessment(assessmentId, organisationId);
  }

  /**
   * The cohort as a CSV, in the order the caller is looking at it.
   *
   * A POST because the body carries the rows to include — the filtering and
   * sorting live in the view, and re-deriving them here would be a second
   * implementation to keep in step. Recruiters forward these to hiring
   * managers who never sign in.
   */
  @Post('assessments/:assessmentId/export')
  async exportCohort(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: ExportCohortDto,
    @CurrentOrg() organisationId: string,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.reports.exportCohort(
      assessmentId,
      organisationId,
      dto.sessionIds ?? [],
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="adaptivehire-results.csv"',
    );
    res.send(csv);
  }

  /** Layer one: the stored summary, scores and recommendation. */
  @Get('sessions/:sessionId')
  summary(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.reports.summary(sessionId, organisationId);
  }

  /**
   * The whole report as a PDF, summary and evidence together.
   *
   * A GET returning a file rather than JSON: the client fetches it as a blob
   * and clicks a synthetic `<a download>`, which is the same path the CSV
   * export takes and the reason the browser's print dialog is no longer in the
   * way. The filename is derived from the report, not sent by the caller —
   * this string reaches a response header.
   */
  @Get('sessions/:sessionId/pdf')
  async exportPdf(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentOrg() organisationId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, body } = await this.reports.exportReportPdf(
      sessionId,
      organisationId,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }

  /** Layer two: every answer and every proctoring event, queried live. */
  @Get('sessions/:sessionId/detail')
  detail(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.reports.detail(sessionId, organisationId);
  }

  /**
   * Shortlist, reject, tag or annotate an attempt.
   *
   * A partial update — only the fields sent are changed. The row belongs to the
   * whole organisation, so a full replacement would let one person blank a
   * colleague's note by shortlisting from a list view.
   */
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Put('sessions/:sessionId/review')
  saveReview(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: SaveReviewDto,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reports.saveReview(sessionId, organisationId, userId, dto);
  }

  /**
   * Tells the candidate they were not taken forward.
   *
   * Its own route rather than a side effect of `saveReview`, because it is the
   * one action in the product that reaches a person and cannot be undone. The
   * decision has to already be `rejected` (400 otherwise), and a second call
   * is refused (409) rather than quietly sending again.
   *
   * Admin and above: a rejection goes out under the company's name, so it is a
   * heavier act than tagging an attempt, which any hiring manager may do.
   */
  @MinOrgRole(OrgRole.ADMIN)
  @Post('sessions/:sessionId/rejection-email')
  sendRejectionEmail(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.reports.sendRejectionEmail(sessionId, organisationId);
  }

  /**
   * Writes to the candidate directly.
   *
   * The route back to somebody already rejected: that decision is final, so
   * changing your mind means talking to them rather than flipping a flag.
   * Hiring manager and above — this is ordinary correspondence about their own
   * requisition, not a workspace-level act like a rejection.
   */
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Post('sessions/:sessionId/messages')
  sendMessage(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: SendCandidateMessageDto,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reports.sendCandidateMessage(
      sessionId,
      organisationId,
      userId,
      dto.message,
    );
  }

  /** What this organisation has already written to one candidate. */
  @Get('sessions/:sessionId/messages')
  messages(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.reports.listCandidateMessages(sessionId, organisationId);
  }

  /**
   * Recompute on demand. Useful after a scoring-rule change, and the manual
   * escape hatch if a queued job failed in a way the read path didn't catch.
   */
  @Post('sessions/:sessionId/regenerate')
  regenerate(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.reports.regenerate(sessionId, organisationId);
  }
}
