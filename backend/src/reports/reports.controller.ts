import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
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
  ) {
    return this.reports.listForAssessment(assessmentId);
  }

  /** Layer one: the stored summary, scores and recommendation. */
  @Get('sessions/:sessionId')
  summary(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.reports.summary(sessionId);
  }

  /** Layer two: every answer and every proctoring event, queried live. */
  @Get('sessions/:sessionId/detail')
  detail(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.reports.detail(sessionId);
  }

  /**
   * Recompute on demand. Useful after a scoring-rule change, and the manual
   * escape hatch if a queued job failed in a way the read path didn't catch.
   */
  @Post('sessions/:sessionId/regenerate')
  regenerate(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.reports.generate(sessionId);
  }
}
