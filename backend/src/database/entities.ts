import { Assessment } from '../assessments/entities/assessment.entity';
import { AssessmentModule } from '../assessments/entities/assessment-module.entity';
import { AssessmentQuestion } from '../assessments/entities/assessment-question.entity';
import { Invitation } from '../invitations/entities/invitation.entity';
import { ModuleCatalogEntry } from '../modules-catalog/entities/module.entity';
import { Organisation } from '../organisations/entities/organisation.entity';
import { ProctoringLog } from '../proctoring/entities/proctoring-log.entity';
import { McqQuestionDetails } from '../question-bank/entities/mcq-question-details.entity';
import { PersonalityQuestionDetails } from '../question-bank/entities/personality-question-details.entity';
import { Question } from '../question-bank/entities/question.entity';
import { Report } from '../reports/entities/report.entity';
import { AssessmentSession } from '../sessions/entities/assessment-session.entity';
import { Response } from '../sessions/entities/response.entity';
import { SessionModuleResult } from '../sessions/entities/session-module-result.entity';
import { User } from '../users/entities/user.entity';

/** Single registry so the app module and the migration CLI never drift apart. */
export const entities = [
  // First: every other tenant-scoped table references it.
  Organisation,
  User,
  ModuleCatalogEntry,
  Question,
  McqQuestionDetails,
  PersonalityQuestionDetails,
  Assessment,
  AssessmentModule,
  AssessmentQuestion,
  Invitation,
  AssessmentSession,
  SessionModuleResult,
  Response,
  ProctoringLog,
  Report,
];
