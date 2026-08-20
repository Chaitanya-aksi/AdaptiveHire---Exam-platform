import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MinOrgRole } from '../common/decorators/org-roles.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgRole, QuestionStatus, UserRole } from '../common/enums';
import { CreateQuestionDto } from './dto/create-question.dto';
import { QueryQuestionsDto } from './dto/query-questions.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { ItemAnalysisService } from './item-analysis.service';
import { QuestionBankService } from './question-bank.service';

/**
 * Recruiter/admin only, at the class level — a candidate must never be able to
 * read the question bank, since `mcq_question_details` carries the answers.
 */
@Roles(UserRole.RECRUITER_ADMIN)
@Controller('questions')
export class QuestionBankController {
  constructor(
    private readonly questions: QuestionBankService,
    private readonly itemAnalysis: ItemAnalysisService,
  ) {}

  @Get()
  findAll(
    @Query() query: QueryQuestionsDto,
    @CurrentOrg() organisationId: string,
  ) {
    return this.questions.findAll(query, organisationId);
  }

  /** Declared before :id so the literal path wins the route match. */
  @Get('stats')
  stats(@CurrentOrg() organisationId: string) {
    return this.questions.moduleStats(organisationId);
  }

  /**
   * How each question is actually performing: observed difficulty, whether it
   * separates strong candidates from weak ones, and which options nobody picks.
   *
   * Also before `:id`, for the same reason.
   */
  @Get('analysis')
  analysis(
    @CurrentOrg() organisationId: string,
    @Query('moduleId', new ParseUUIDPipe({ optional: true }))
    moduleId?: string,
  ) {
    return this.itemAnalysis.forOrganisation(organisationId, { moduleId });
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.questions.findOne(id, organisationId);
  }

  @MinOrgRole(OrgRole.ADMIN)
  @Post()
  create(
    @Body() dto: CreateQuestionDto,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.questions.create(dto, organisationId, userId);
  }

  @MinOrgRole(OrgRole.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.questions.update(id, dto, organisationId, userId);
  }

  /** Flip a reviewed draft to active so the selector can serve it. */
  @MinOrgRole(OrgRole.ADMIN)
  @Patch(':id/activate')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.questions.setStatus(
      id,
      QuestionStatus.ACTIVE,
      organisationId,
      userId,
    );
  }

  /** Soft-remove — keeps the row and its history, just stops it being served. */
  @MinOrgRole(OrgRole.ADMIN)
  @Patch(':id/archive')
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.questions.archive(id, organisationId, userId);
  }

  /**
   * Permanent delete. The service refuses (409) if any candidate has answered
   * the question, so answered questions can only ever be archived.
   */
  @MinOrgRole(OrgRole.ADMIN)
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.questions.remove(id, organisationId);
  }
}
