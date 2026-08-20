import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `face_not_framed` to the proctoring event types.
 *
 * Face presence used to be measured by counting faces, which is why this is
 * needed: a camera angled at the ceiling with the candidate's head in one
 * corner of frame logged nothing at all, because a face was present and the
 * count was one. The runtime now measures whether that face is actually
 * *framed* — centred, and near enough to judge — and this is the event for the
 * case where it is not.
 *
 * Deliberately its own value rather than reusing `face_absent`. An occupied
 * chair reported as an empty one is a false claim in somebody's hiring record,
 * and every event type here is named for what was measured — the same rule
 * that gave `background_noise` its name.
 */
export class FaceNotFramedEvent1786710000000 implements MigrationInterface {
  name = 'FaceNotFramedEvent1786710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres enums grow with ADD VALUE. `IF NOT EXISTS` so a re-run on a
    // database that already has it is not an error.
    await queryRunner.query(`
      ALTER TYPE "proctoring_logs_eventtype_enum"
        ADD VALUE IF NOT EXISTS 'face_not_framed'
    `);
  }

  public async down(): Promise<void> {
    // Deliberately not removed, for the same reason as `background_noise`
    // before it: Postgres cannot drop a value from an enum without rebuilding
    // the type, and any row already logged with it would have to be deleted or
    // rewritten first. Destroying real proctoring history to reverse a schema
    // change is the wrong trade, and an unused enum value costs nothing.
  }
}
