import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recruiter workflow state: shortlist, reject, tag, leave a note.
 *
 * Kept out of `reports` on purpose. That table is regenerated from the answers
 * whenever a report is rebuilt, and a shortlisting that vanished because
 * somebody pressed "regenerate" would be worse than not having the feature.
 *
 * Keyed on session **and organisation** rather than on the individual
 * recruiter, because the requirement is that colleagues see each other's
 * notes. A candidate who sat assessments for two companies gets one review row
 * per company, and neither can see the other's.
 */
export class CandidateReviews1786610000000 implements MigrationInterface {
  name = 'CandidateReviews1786610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."candidate_reviews_decision_enum"
        AS ENUM('shortlisted', 'rejected')
    `);

    await queryRunner.query(`
      CREATE TABLE "candidate_reviews" (
        "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionId"      uuid NOT NULL,
        "organisationId" uuid NOT NULL,
        "decision"       "public"."candidate_reviews_decision_enum",
        "tags"           text array NOT NULL DEFAULT '{}',
        "note"           text,
        "updatedById"    uuid,
        "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_candidate_reviews" PRIMARY KEY ("id")
      )
    `);

    // One review per attempt per company — the upsert on write depends on it.
    await queryRunner.query(`
      ALTER TABLE "candidate_reviews"
        ADD CONSTRAINT "UQ_candidate_reviews_session_org"
        UNIQUE ("sessionId", "organisationId")
    `);

    await queryRunner.query(`
      ALTER TABLE "candidate_reviews"
        ADD CONSTRAINT "FK_candidate_reviews_session"
        FOREIGN KEY ("sessionId") REFERENCES "assessment_sessions"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "candidate_reviews"
        ADD CONSTRAINT "FK_candidate_reviews_org"
        FOREIGN KEY ("organisationId") REFERENCES "organisations"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // SET NULL, not CASCADE: a decision outlives the person who made it, and a
    // recruiter leaving must not erase what their team decided.
    await queryRunner.query(`
      ALTER TABLE "candidate_reviews"
        ADD CONSTRAINT "FK_candidate_reviews_updated_by"
        FOREIGN KEY ("updatedById") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // The cohort view's filter: this company's reviews, by decision.
    await queryRunner.query(`
      CREATE INDEX "IDX_candidate_reviews_org_decision"
        ON "candidate_reviews" ("organisationId", "decision")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_candidate_reviews_org_decision"`,
    );
    await queryRunner.query(
      `ALTER TABLE "candidate_reviews" DROP CONSTRAINT "FK_candidate_reviews_updated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "candidate_reviews" DROP CONSTRAINT "FK_candidate_reviews_org"`,
    );
    await queryRunner.query(
      `ALTER TABLE "candidate_reviews" DROP CONSTRAINT "FK_candidate_reviews_session"`,
    );
    await queryRunner.query(
      `ALTER TABLE "candidate_reviews" DROP CONSTRAINT "UQ_candidate_reviews_session_org"`,
    );
    await queryRunner.query(`DROP TABLE "candidate_reviews"`);
    await queryRunner.query(
      `DROP TYPE "public"."candidate_reviews_decision_enum"`,
    );
  }
}
