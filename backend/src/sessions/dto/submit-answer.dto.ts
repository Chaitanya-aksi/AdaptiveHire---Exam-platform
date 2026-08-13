import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { MAX_OPTIONS } from '../../question-bank/question-bank.constants';

export class SubmitAnswerDto {
  /**
   * Echoed back so a stale tab can't answer the question it *thinks* is on
   * screen — the server rejects anything that isn't the one it served.
   */
  @IsUUID()
  questionId!: string;

  /**
   * The chosen option key. Used by every question shape except ranking.
   *
   * Exactly one of this and `selectedOptions` must be supplied; the service
   * enforces that, since it also has to check the answer against the shape of
   * the question that was actually served.
   */
  @IsOptional()
  @IsString()
  @Length(1, 16)
  selectedOption?: string;

  /**
   * A ranking question's ordering, strongest preference first. Order carries
   * the meaning, so it is never sorted or de-duplicated on the way in — an
   * incomplete or repeated ordering is rejected rather than repaired.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_OPTIONS)
  @IsString({ each: true })
  @Length(1, 16, { each: true })
  selectedOptions?: string[];

  // No timeTaken field on purpose: it is derived from the server's serve
  // timestamp, so it can't be under-reported.
}
