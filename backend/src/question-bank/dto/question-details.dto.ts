import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  MAX_DIFFICULTY,
  MAX_OPTIONS,
  MIN_DIFFICULTY,
  MIN_OPTIONS,
} from '../question-bank.constants';

export class McqOptionDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_]{1,8}$/, {
    message: 'option key must be 1-8 alphanumeric characters, e.g. "A"',
  })
  key!: string;

  @IsString()
  @Length(1, 2000)
  text!: string;
}

export class McqDetailsDto {
  @IsArray()
  @ArrayMinSize(MIN_OPTIONS)
  @ArrayMaxSize(MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => McqOptionDto)
  options!: McqOptionDto[];

  /** Must match one of `options[].key` — checked in the service. */
  @IsString()
  @Length(1, 8)
  correctOption!: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_DIFFICULTY)
  @Max(MAX_DIFFICULTY)
  difficultyScore?: number;
}

export class PersonalityOptionDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_]{1,8}$/, {
    message: 'option key must be 1-8 alphanumeric characters, e.g. "A"',
  })
  key!: string;

  @IsString()
  @Length(1, 2000)
  text!: string;

  /**
   * trait key -> weight. Every key must be declared by the module; the
   * service enforces that, since only it knows which module this belongs to.
   */
  @IsObject()
  traitWeights!: Record<string, number>;
}

export class PersonalityDetailsDto {
  @IsArray()
  @ArrayMinSize(MIN_OPTIONS)
  @ArrayMaxSize(MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => PersonalityOptionDto)
  options!: PersonalityOptionDto[];
}
