import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { AssessmentsService } from './assessments.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';

/**
 * Assessment authoring is recruiter-only. Candidates never hit these routes —
 * they see the assessments they're invited to via GET /me/invitations.
 */
@Roles(UserRole.RECRUITER_ADMIN)
@Controller('assessments')
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Post()
  create(@Body() dto: CreateAssessmentDto, @CurrentUser('id') userId: string) {
    return this.assessments.create(dto, userId);
  }

  @Get()
  findAll() {
    return this.assessments.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.findOne(id);
  }
}
