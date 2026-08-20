import { Assessment } from '../assessments/entities/assessment.entity';
import { PasswordResetToken } from '../auth/entities/password-reset-token.entity';
import { AuditLogEntry } from '../common/audit/audit-log.entity';
import { AssessmentModule } from '../assessments/entities/assessment-module.entity';
import { AssessmentQuestion } from '../assessments/entities/assessment-question.entity';
import { Invitation } from '../invitations/entities/invitation.entity';
import { ModuleCatalogEntry } from '../modules-catalog/entities/module.entity';
import { Organisation } from '../organisations/entities/organisation.entity';
import { ProctoringLog } from '../proctoring/entities/proctoring-log.entity';
import { McqQuestionDetails } from '../question-bank/entities/mcq-question-details.entity';
import { PersonalityQuestionDetails } from '../question-bank/entities/personality-question-details.entity';
import { Question } from '../question-bank/entities/question.entity';
import { CandidateMessage } from '../reports/entities/candidate-message.entity';
import { CandidateReview } from '../reports/entities/candidate-review.entity';
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
  // Straight after User: it references nothing else.
  PasswordResetToken,
  ModuleCatalogEntry,
  // An aggregate over session results, but it hangs off a module and nothing
  // hangs off it — so it sits with the module rather than with the sessions.
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
  // Recruiter workflow state; references a session and an organisation.
  CandidateReview,
  // Outbound correspondence with a candidate. Same references as the review
  // above, and likewise nothing references it.
  CandidateMessage,
  // Last: it references users but nothing references it.
  AuditLogEntry,
];
