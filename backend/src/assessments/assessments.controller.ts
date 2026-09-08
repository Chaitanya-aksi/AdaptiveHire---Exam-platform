import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MinOrgRole } from '../common/decorators/org-roles.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgRole, UserRole } from '../common/enums';
import { AssessmentsService } from './assessments.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { SetCompanyDto } from './dto/set-company.dto';
import { SetQuestionPoolDto } from './dto/set-question-pool.dto';

/**
 * Assessment authoring is recruiter-only. Candidates never hit these routes —
 * they see the assessments they're invited to via GET /me/invitations.
 */
@Roles(UserRole.RECRUITER_ADMIN)
@Controller('assessments')
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Post()
  create(
    @Body() dto: CreateAssessmentDto,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.assessments.create(dto, organisationId, userId);
  }

  @Get()
  findAll(@CurrentOrg() organisationId: string) {
    return this.assessments.findAll(organisationId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.assessments.findOne(id, organisationId);
  }

  /**
   * Replaces which questions the engine may draw from.
   *
   * `PUT` rather than `PATCH` because the body is the whole intended set, not a
   * change to it. An empty list clears the pool, which means no restriction.
   */
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Put(':id/questions')
  setQuestionPool(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetQuestionPoolDto,
    @CurrentOrg() organisationId: string,
  ) {
    return this.assessments.setQuestionPool(
      id,
      dto.questionIds,
      organisationId,
    );
  }

  /**
   * Sets which business in the group this round is for, or `null` for the
   * workspace itself.
   *
   * Hiring manager rather than admin, unlike creating the companies themselves:
   * choosing which of the group's businesses a round belongs to is ordinary
   * recruiting work, while deciding what those businesses are and how they look
   * is a workspace-level decision.
   */
  @MinOrgRole(OrgRole.HIRING_MANAGER)
  @Patch(':id/company')
  setCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCompanyDto,
    @CurrentOrg() organisationId: string,
  ) {
    return this.assessments.setCompany(id, dto.companyId, organisationId);
  }

  /**
   * Deletes the assessment and every attempt made on it — answers, reports and
   * proctoring logs included. Candidate accounts survive; only their data for
   * this assessment goes.
   */
  @MinOrgRole(OrgRole.ADMIN)
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.assessments.remove(id, organisationId);
  }
}
