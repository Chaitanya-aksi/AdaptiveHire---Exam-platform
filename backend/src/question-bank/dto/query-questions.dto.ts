import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { QuestionStatus } from '../../common/enums';
import { MAX_DIFFICULTY, MIN_DIFFICULTY } from '../question-bank.constants';

export class QueryQuestionsDto {
  @IsOptional()
  @IsUUID()
  moduleId?: string;

  @IsOptional()
  @IsEnum(QuestionStatus)
  status?: QuestionStatus;

  /** Repeatable query param, or comma-separated. Matches questions having ALL listed tags. */
  @IsOptional()
  @Transform(({ value }): string[] =>
    Array.isArray(value)
      ? (value as string[])
      : String(value)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
  )
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** Case-insensitive substring match on question text. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_DIFFICULTY)
  @Max(MAX_DIFFICULTY)
  minDifficulty?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_DIFFICULTY)
  @Max(MAX_DIFFICULTY)
  maxDifficulty?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 25;
}
