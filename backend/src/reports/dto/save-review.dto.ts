import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ReviewDecision } from '../entities/candidate-review.entity';

/**
 * A partial update: every field is optional, and only the ones sent are
 * changed.
 *
 * That matters because this row is shared by a whole organisation. Someone
 * shortlisting a candidate from a list must not blank the note a colleague
 * wrote, which is what a full-replacement payload would do the moment the UI
 * forgot to send a field back.
 *
 * `null` and absent therefore mean different things: sending `decision: null`
 * clears the decision, omitting it leaves it alone.
 */
export class SaveReviewDto {
  @IsOptional()
  // Allows an explicit null through to mean "undecide", which `@IsEnum` alone
  // would reject.
  @ValidateIf((_, value) => value !== null)
  @IsEnum(ReviewDecision)
  decision?: ReviewDecision | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  tags?: string[];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(4000)
  note?: string | null;
}
