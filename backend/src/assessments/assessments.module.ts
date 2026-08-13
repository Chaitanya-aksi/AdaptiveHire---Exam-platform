import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuleCatalogEntry } from '../modules-catalog/entities/module.entity';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { AssessmentModule } from './entities/assessment-module.entity';
import { AssessmentQuestion } from './entities/assessment-question.entity';
import { Assessment } from './entities/assessment.entity';
import { Question } from '../question-bank/entities/question.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Assessment,
      AssessmentModule,
      AssessmentQuestion,
      ModuleCatalogEntry,
      // The pool is validated against the question bank's visibility rule, so
      // the service needs to read questions directly.
      Question,
    ]),
  ],
  controllers: [AssessmentsController],
  providers: [AssessmentsService],
  exports: [AssessmentsService],
})
export class AssessmentsModule {}
