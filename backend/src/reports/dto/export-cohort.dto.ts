import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * Which attempts to put in the file, in the order they should appear.
 *
 * The caller sends what it is showing, because the filtering and sorting live
 * in the cohort view and a second implementation on the server would
 * eventually disagree with it. Every id is still checked against the
 * organisation before anything is written — this decides presentation, not
 * access.
 *
 * Omitted means "everything", so a script can export without reproducing the
 * UI's state.
 */
export class ExportCohortDto {
  @IsOptional()
  @IsArray()
  /*
   * A backstop, and in practice an unreachable one: Express's body-size limit
   * refuses roughly 2,700 UUIDs with a 413 long before this fires. It stays
   * because the limit that actually bites lives in another layer's
   * configuration, and a cohort large enough to matter should be refused by
   * something whether or not that setting is ever raised.
   */
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  sessionIds?: string[];
}
