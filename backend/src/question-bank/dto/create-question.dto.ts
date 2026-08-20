import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { QuestionStatus } from '../../common/enums';
import { McqDetailsDto, PersonalityDetailsDto } from './question-details.dto';

/**
 * One endpoint covers both question kinds. Exactly one of `mcq` /
 * `personality` must be supplied, and it must match the target module's
 * scoring type — enforced in the service, which is the only place that knows
 * the module.
 */
export class CreateQuestionDto {
  @IsUUID()
  moduleId!: string;

  @IsString()
  @Length(3, 5000)
  questionText!: string;

  @IsOptional()
  @IsEnum(QuestionStatus)
  status?: QuestionStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  tags?: string[];

  /**
   * Twins this question with the others carrying the same group, so the engine
   * can serve one of them well after the other and compare the two answers.
   *
   * Both twins must be in the same module and must be written as genuinely
   * different questions — a reworded stem is not enough on its own if the
   * options still read the same, because a candidate who recognises the repeat
   * will simply reproduce their first answer.
   *
   * An empty string is allowed and means "not twinned" — that is how an update
   * clears an existing pairing.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  probeGroup?: string;

  /**
   * Marks this as a practice question, shown before an assessment starts.
   *
   * The adaptive selector and the assessment pools both refuse a sample, so
   * ticking this takes the question permanently out of circulation for real
   * attempts — which is the point, since practice reveals the answer.
   */
  @IsOptional()
  @IsBoolean()
  isSample?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => McqDetailsDto)
  mcq?: McqDetailsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalityDetailsDto)
  personality?: PersonalityDetailsDto;
}
