import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1784785952618 implements MigrationInterface {
  name = 'InitialSchema1784785952618';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."invitations_status_enum" AS ENUM('pending', 'in_progress', 'completed', 'expired', 'revoked')`,
    );
    await queryRunner.query(
      `CREATE TABLE "invitations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "assessmentId" uuid NOT NULL, "candidateId" uuid NOT NULL, "invitedById" uuid, "status" "public"."invitations_status_enum" NOT NULL DEFAULT 'pending', "expiresAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_de4b11f2e505d43d1fb946fe2fa" UNIQUE ("assessmentId", "candidateId"), CONSTRAINT "PK_5dec98cfdfd562e4ad3648bbb07" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "mcq_question_details" ("questionId" uuid NOT NULL, "options" jsonb NOT NULL, "correctOption" character varying(16) NOT NULL, "difficultyScore" integer NOT NULL DEFAULT '1000', "timesUsed" integer NOT NULL DEFAULT '0', "timesCorrect" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_994c9319323493016f6eed17a1a" PRIMARY KEY ("questionId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_245953edf2d7390e6df059422a" ON "mcq_question_details"  ("difficultyScore") `,
    );
    await queryRunner.query(
      `CREATE TABLE "personality_question_details" ("questionId" uuid NOT NULL, "options" jsonb NOT NULL, "timesUsed" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_aa7469a7ac1fcf3184d462f20a4" PRIMARY KEY ("questionId"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."questions_status_enum" AS ENUM('draft', 'active', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TABLE "questions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "moduleId" uuid NOT NULL, "questionText" text NOT NULL, "status" "public"."questions_status_enum" NOT NULL DEFAULT 'draft', "tags" text array NOT NULL DEFAULT '{}', "createdById" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_08a6d4b0f49ff300bf3a0ca60ac" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_91cb0dee5bd84cdcc8996b6e75" ON "questions"  ("moduleId", "status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."modules_scoringtype_enum" AS ENUM('objective', 'trait')`,
    );
    await queryRunner.query(
      `CREATE TABLE "modules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(120) NOT NULL, "slug" character varying(120) NOT NULL, "description" text, "scoringType" "public"."modules_scoringtype_enum" NOT NULL, "traits" text array, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7dbefd488bd96c5bf31f0ce0c95" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8cd1abde4b70e59644c98668c0" ON "modules"  ("name") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_503404f7e2e602815906fa62e5" ON "modules"  ("slug") `,
    );
    await queryRunner.query(
      `CREATE TABLE "responses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "moduleId" uuid NOT NULL, "questionId" uuid NOT NULL, "selectedOption" character varying(16), "isCorrect" boolean, "abilityEstimateAfter" numeric(8,2), "questionDifficultyAtServe" numeric(8,2), "sequenceNumber" integer NOT NULL, "timeTakenMs" integer, "answeredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_d51c4d492e5a64366311f2e5eae" UNIQUE ("sessionId", "questionId"), CONSTRAINT "PK_be3bdac59bd243dff421ad7bf70" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_91976354eaf5320016011846c6" ON "responses"  ("sessionId", "sequenceNumber") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."session_module_results_stopreason_enum" AS ENUM('confidence_reached', 'max_questions', 'time_expired', 'pool_exhausted')`,
    );
    await queryRunner.query(
      `CREATE TABLE "session_module_results" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "moduleId" uuid NOT NULL, "abilityScore" numeric(8,2), "traitScores" jsonb, "questionsAnswered" integer NOT NULL DEFAULT '0', "questionsCorrect" integer NOT NULL DEFAULT '0', "stopReason" "public"."session_module_results_stopreason_enum", "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_cf11dfffd46da9aa75c8ae29def" UNIQUE ("sessionId", "moduleId"), CONSTRAINT "PK_ccdba5a1b7d926d2217cd642c5d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."assessment_sessions_status_enum" AS ENUM('in_progress', 'completed', 'auto_submitted', 'abandoned')`,
    );
    await queryRunner.query(
      `CREATE TABLE "assessment_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "invitationId" uuid NOT NULL, "assessmentId" uuid NOT NULL, "candidateId" uuid NOT NULL, "status" "public"."assessment_sessions_status_enum" NOT NULL DEFAULT 'in_progress', "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "submittedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_95e336acba1ba5f4eeb5fca0194" UNIQUE ("invitationId"), CONSTRAINT "REL_95e336acba1ba5f4eeb5fca019" UNIQUE ("invitationId"), CONSTRAINT "PK_bf474814c4c2937be715ab78d9e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c0279fc296af2139741467ed3c" ON "assessment_sessions"  ("candidateId", "status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('candidate', 'recruiter_admin')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255) NOT NULL, "passwordHash" character varying(255) NOT NULL, "hashedRefreshToken" character varying(255), "fullName" character varying(150) NOT NULL, "role" "public"."users_role_enum" NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users"  ("email") `,
    );
    await queryRunner.query(
      `CREATE TABLE "assessment_modules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "assessmentId" uuid NOT NULL, "moduleId" uuid NOT NULL, "minQuestions" integer NOT NULL, "maxQuestions" integer NOT NULL, "timeLimitSeconds" integer NOT NULL, "displayOrder" integer NOT NULL DEFAULT '0', CONSTRAINT "UQ_3195dae1f8f3dde046ec92aee65" UNIQUE ("assessmentId", "moduleId"), CONSTRAINT "PK_fa6c7a7a85b4be526eb5ae7b2ec" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "assessments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(200) NOT NULL, "description" text, "isActive" boolean NOT NULL DEFAULT true, "createdById" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3442bd80a00e9111cefca57f6c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."proctoring_logs_eventtype_enum" AS ENUM('tab_switch', 'fullscreen_exit', 'face_absent', 'multiple_faces', 'multiple_displays_detected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "proctoring_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "eventType" "public"."proctoring_logs_eventtype_enum" NOT NULL, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "metadata" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d5e90efbabf6c740f5dfd22102d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_07e3b7a92eb87f7ced04626f95" ON "proctoring_logs"  ("sessionId", "occurredAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."reports_hiringrecommendation_enum" AS ENUM('strongly_recommended', 'recommended', 'borderline', 'not_recommended')`,
    );
    await queryRunner.query(
      `CREATE TABLE "reports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "summary" text NOT NULL, "strengths" jsonb NOT NULL DEFAULT '[]', "weaknesses" jsonb NOT NULL DEFAULT '[]', "hiringRecommendation" "public"."reports_hiringrecommendation_enum" NOT NULL, "overallScore" numeric(5,2), "generatedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_2a732cde6d4172fa7d668e15416" UNIQUE ("sessionId"), CONSTRAINT "REL_2a732cde6d4172fa7d668e1541" UNIQUE ("sessionId"), CONSTRAINT "PK_d9013193989303580053c0b5ef6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "FK_ddc98f91c59170ffe68dbf30aa8" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "FK_9a7726fb24d1c93f041aee1fe52" FOREIGN KEY ("candidateId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "FK_b60325e5302be0dad38b423314c" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mcq_question_details" ADD CONSTRAINT "FK_994c9319323493016f6eed17a1a" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "personality_question_details" ADD CONSTRAINT "FK_aa7469a7ac1fcf3184d462f20a4" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" ADD CONSTRAINT "FK_e210b876c917c60051043133b1e" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" ADD CONSTRAINT "FK_0483ccbf84f12cc70caff7b9075" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "responses" ADD CONSTRAINT "FK_44a85be93c5253b8da1b1825473" FOREIGN KEY ("sessionId") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "responses" ADD CONSTRAINT "FK_81e5a04bbdc34ac14bbb7f96ce3" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "responses" ADD CONSTRAINT "FK_016857bf93ba3feccdf2b2c7521" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_module_results" ADD CONSTRAINT "FK_43c497e8af7a7b5f25e48a67242" FOREIGN KEY ("sessionId") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_module_results" ADD CONSTRAINT "FK_7147f83a8a2b12fcb9b99e408e7" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessment_sessions" ADD CONSTRAINT "FK_95e336acba1ba5f4eeb5fca0194" FOREIGN KEY ("invitationId") REFERENCES "invitations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessment_sessions" ADD CONSTRAINT "FK_863c813fdc84a3c0face7661291" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessment_sessions" ADD CONSTRAINT "FK_5db33869e5c10d6262cd7001f37" FOREIGN KEY ("candidateId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessment_modules" ADD CONSTRAINT "FK_c844ed486de8eac9375008ed7a6" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessment_modules" ADD CONSTRAINT "FK_7aff5fd20ef6603fd320c174995" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessments" ADD CONSTRAINT "FK_9e6d5a430670a67c387bf424212" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "proctoring_logs" ADD CONSTRAINT "FK_f3da5cf1c522d9cc94b369c3346" FOREIGN KEY ("sessionId") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_2a732cde6d4172fa7d668e15416" FOREIGN KEY ("sessionId") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_2a732cde6d4172fa7d668e15416"`,
    );
    await queryRunner.query(
      `ALTER TABLE "proctoring_logs" DROP CONSTRAINT "FK_f3da5cf1c522d9cc94b369c3346"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessments" DROP CONSTRAINT "FK_9e6d5a430670a67c387bf424212"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessment_modules" DROP CONSTRAINT "FK_7aff5fd20ef6603fd320c174995"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessment_modules" DROP CONSTRAINT "FK_c844ed486de8eac9375008ed7a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessment_sessions" DROP CONSTRAINT "FK_5db33869e5c10d6262cd7001f37"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessment_sessions" DROP CONSTRAINT "FK_863c813fdc84a3c0face7661291"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assessment_sessions" DROP CONSTRAINT "FK_95e336acba1ba5f4eeb5fca0194"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_module_results" DROP CONSTRAINT "FK_7147f83a8a2b12fcb9b99e408e7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_module_results" DROP CONSTRAINT "FK_43c497e8af7a7b5f25e48a67242"`,
    );
    await queryRunner.query(
      `ALTER TABLE "responses" DROP CONSTRAINT "FK_016857bf93ba3feccdf2b2c7521"`,
    );
    await queryRunner.query(
      `ALTER TABLE "responses" DROP CONSTRAINT "FK_81e5a04bbdc34ac14bbb7f96ce3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "responses" DROP CONSTRAINT "FK_44a85be93c5253b8da1b1825473"`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" DROP CONSTRAINT "FK_0483ccbf84f12cc70caff7b9075"`,
    );
    await queryRunner.query(
      `ALTER TABLE "questions" DROP CONSTRAINT "FK_e210b876c917c60051043133b1e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "personality_question_details" DROP CONSTRAINT "FK_aa7469a7ac1fcf3184d462f20a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mcq_question_details" DROP CONSTRAINT "FK_994c9319323493016f6eed17a1a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_b60325e5302be0dad38b423314c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_9a7726fb24d1c93f041aee1fe52"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_ddc98f91c59170ffe68dbf30aa8"`,
    );
    await queryRunner.query(`DROP TABLE "reports"`);
    await queryRunner.query(
      `DROP TYPE "public"."reports_hiringrecommendation_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_07e3b7a92eb87f7ced04626f95"`,
    );
    await queryRunner.query(`DROP TABLE "proctoring_logs"`);
    await queryRunner.query(
      `DROP TYPE "public"."proctoring_logs_eventtype_enum"`,
    );
    await queryRunner.query(`DROP TABLE "assessments"`);
    await queryRunner.query(`DROP TABLE "assessment_modules"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c0279fc296af2139741467ed3c"`,
    );
    await queryRunner.query(`DROP TABLE "assessment_sessions"`);
    await queryRunner.query(
      `DROP TYPE "public"."assessment_sessions_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "session_module_results"`);
    await queryRunner.query(
      `DROP TYPE "public"."session_module_results_stopreason_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_91976354eaf5320016011846c6"`,
    );
    await queryRunner.query(`DROP TABLE "responses"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_503404f7e2e602815906fa62e5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8cd1abde4b70e59644c98668c0"`,
    );
    await queryRunner.query(`DROP TABLE "modules"`);
    await queryRunner.query(`DROP TYPE "public"."modules_scoringtype_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_91cb0dee5bd84cdcc8996b6e75"`,
    );
    await queryRunner.query(`DROP TABLE "questions"`);
    await queryRunner.query(`DROP TYPE "public"."questions_status_enum"`);
    await queryRunner.query(`DROP TABLE "personality_question_details"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_245953edf2d7390e6df059422a"`,
    );
    await queryRunner.query(`DROP TABLE "mcq_question_details"`);
    await queryRunner.query(`DROP TABLE "invitations"`);
    await queryRunner.query(`DROP TYPE "public"."invitations_status_enum"`);
  }
}
