import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
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

import { BehavioralPattern } from '../../common/enums';
import {
  MAX_DIFFICULTY,
  MAX_OPTIONS,
  MIN_DIFFICULTY,
  MIN_OPTIONS,
  PERSONALITY_MIN_OPTIONS,
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
   * trait key -> weight. Every key must be declared by the module and every
   * weight must sit within the engine's scale; the service enforces both,
   * since only it knows which module this belongs to.
   */
  @IsObject()
  traitWeights!: Record<string, number>;

  /**
   * Optional categorical label for the tendency this option expresses
   * ('Collaborative', 'Independent'). Never scored — it exists so the
   * recruiter's evidence view can name the behaviour that was chosen.
   */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  behavior?: string;
}

export class PersonalityDetailsDto {
  /**
   * Which behavioural shape this question takes. Required when creating a new
   * question; omitting it on an update leaves the stored pattern alone, so a
   * legacy Likert item can be corrected without being mislabelled as
   * situational.
   */
  @IsOptional()
  @IsEnum(BehavioralPattern)
  pattern?: BehavioralPattern;

  /**
   * Bounds here are the loosest any pattern allows. The exact per-pattern
   * count is checked in the service against `PATTERN_OPTION_BOUNDS`.
   */
  @IsArray()
  @ArrayMinSize(PERSONALITY_MIN_OPTIONS)
  @ArrayMaxSize(MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => PersonalityOptionDto)
  options!: PersonalityOptionDto[];
}
