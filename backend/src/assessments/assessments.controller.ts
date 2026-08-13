import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { AssessmentsService } from './assessments.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { SetQuestionPoolDto } from './dto/set-question-pool.dto';

/**
 * Assessment authoring is recruiter-only. Candidates never hit these routes —
 * they see the assessments they're invited to via GET /me/invitations.
 */
@Roles(UserRole.RECRUITER_ADMIN)
@Controller('assessments')
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

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
}
