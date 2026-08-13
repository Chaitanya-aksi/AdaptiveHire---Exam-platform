import { IsArray, IsUUID } from 'class-validator';

/**
 * Replaces an assessment's question pool with exactly this set.
 *
 * An empty array is valid and meaningful: it clears the pool, returning the
 * assessment to drawing on every question its organisation can see.
 */
export class SetQuestionPoolDto {
  @IsArray()
  @IsUUID('4', { each: true })
  questionIds!: string[];
}
