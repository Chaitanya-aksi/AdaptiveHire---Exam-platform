import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a recruiting team wrote directly to a candidate.
 *
 * Its own table rather than a column on `candidate_reviews`, because a review's
 * `note` is internal and this is the opposite: written to be read by the person
 * it is about. Keeping them in one field would eventually put somebody's blunt
 * internal assessment in a candidate's inbox.
 *
 * Append-only by intent — there is no update path in the service. A sent
 * message cannot be unsent, so a record that could be rewritten afterwards
 * would be worse than none.
 */
export class CandidateMessages1786670000000 implements MigrationInterface {
  name = 'CandidateMessages1786670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "candidate_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "organisationId" uuid NOT NULL,
        "body" text NOT NULL,
        "sentTo" character varying(255) NOT NULL,
        "sentById" uuid,
        "sentAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_candidate_messages" PRIMARY KEY ("id")
      )
    `);

    // CASCADE from both owners: deleting an assessment already destroys its
    // attempts, and a workspace that leaves takes its correspondence with it.
    await queryRunner.query(`
      ALTER TABLE "candidate_messages"
        ADD CONSTRAINT "FK_candidate_messages_session"
        FOREIGN KEY ("sessionId") REFERENCES "assessment_sessions"("id")
        ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "candidate_messages"
        ADD CONSTRAINT "FK_candidate_messages_organisation"
        FOREIGN KEY ("organisationId") REFERENCES "organisations"("id")
        ON DELETE CASCADE
    `);
    // SET NULL, not CASCADE: the record outlives the sender. A recruiter
    // leaving the company must not delete what the company said.
    await queryRunner.query(`
      ALTER TABLE "candidate_messages"
        ADD CONSTRAINT "FK_candidate_messages_sender"
        FOREIGN KEY ("sentById") REFERENCES "users"("id")
        ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_candidate_messages_thread"
        ON "candidate_messages" ("sessionId", "organisationId", "sentAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "candidate_messages"`);
  }
}
