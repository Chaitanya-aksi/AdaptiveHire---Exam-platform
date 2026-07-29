import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
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

  @IsOptional()
  @ValidateNested()
  @Type(() => McqDetailsDto)
  mcq?: McqDetailsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalityDetailsDto)
  personality?: PersonalityDetailsDto;
}
