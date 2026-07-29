import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * One module's slice of an assessment: how many questions the adaptive engine
 * may ask and how long the candidate gets. `min`/`max` bound the stopping
 * engine — the service enforces min <= max, which class-validator can't.
 */
export class AssessmentModuleConfigDto {
  @IsUUID()
  moduleId!: string;

  @IsInt()
  @Min(1)
  minQuestions!: number;

  @IsInt()
  @Min(1)
  maxQuestions!: number;

  @IsInt()
  @Min(1)
  timeLimitSeconds!: number;

  /** Falls back to the array position when omitted. */
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
