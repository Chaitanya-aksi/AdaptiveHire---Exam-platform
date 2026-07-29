import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { ScoringType } from '../../common/enums';
import { TraitDefinitionDto } from './trait-definition.dto';

export class CreateModuleDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase kebab-case, e.g. "logical-reasoning"',
  })
  @Length(2, 120)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ScoringType)
  scoringType!: ScoringType;

  /**
   * Required for `trait` modules, rejected for `objective` ones — the service
   * enforces that pairing, since class-validator can't express it cleanly.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TraitDefinitionDto)
  traits?: TraitDefinitionDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
