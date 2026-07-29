import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuleCatalogEntry } from '../modules-catalog/entities/module.entity';
import { BulkImportController } from './bulk-import/bulk-import.controller';
import { BulkImportService } from './bulk-import/bulk-import.service';
import { McqQuestionDetails } from './entities/mcq-question-details.entity';
import { PersonalityQuestionDetails } from './entities/personality-question-details.entity';
import { Question } from './entities/question.entity';
import { QuestionBankController } from './question-bank.controller';
import { QuestionBankService } from './question-bank.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Question,
      McqQuestionDetails,
      PersonalityQuestionDetails,
      ModuleCatalogEntry,
    ]),
  ],
  // BulkImportController is declared first so its literal
  // /questions/bulk-import path is matched before /questions/:id.
  controllers: [BulkImportController, QuestionBankController],
  providers: [QuestionBankService, BulkImportService],
  exports: [QuestionBankService, BulkImportService],
})
export class QuestionBankModule {}
