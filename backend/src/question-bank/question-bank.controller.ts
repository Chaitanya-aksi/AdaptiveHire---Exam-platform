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
import { Roles } from '../common/decorators/roles.decorator';
import { QuestionStatus, UserRole } from '../common/enums';
import { CreateQuestionDto } from './dto/create-question.dto';
import { QueryQuestionsDto } from './dto/query-questions.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionBankService } from './question-bank.service';

/**
 * Recruiter/admin only, at the class level — a candidate must never be able to
 * read the question bank, since `mcq_question_details` carries the answers.
 */
@Roles(UserRole.RECRUITER_ADMIN)
@Controller('questions')
export class QuestionBankController {
  constructor(private readonly questions: QuestionBankService) {}

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

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.questions.findOne(id, organisationId);
  }

  @Post()
  create(
    @Body() dto: CreateQuestionDto,
    @CurrentOrg() organisationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.questions.create(dto, organisationId, userId);
  }

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
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrg() organisationId: string,
  ) {
    return this.questions.remove(id, organisationId);
  }
}
