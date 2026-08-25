import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * One module's slice of an assessment: how many questions it asks and how long
 * the candidate gets.
 *
 * `questionCount` is exact. It replaced a `min`/`max` pair whose whole purpose
 * was to let a section end early, so there is no longer a cross-field rule for
 * the service to enforce on top of these annotations.
 */
export class AssessmentModuleConfigDto {
  @IsUUID()
  moduleId!: string;

  @IsInt()
  @Min(1)
  questionCount!: number;

  @IsInt()
  @Min(1)
  timeLimitSeconds!: number;

  /** Falls back to the array position when omitted. */
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
