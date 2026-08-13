import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { AssessmentModuleConfigDto } from './assessment-module-config.dto';

export class CreateAssessmentDto {
  @IsString()
  @Length(2, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  /** At least one module — an assessment with no modules has nothing to ask. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssessmentModuleConfigDto)
  modules!: AssessmentModuleConfigDto[];

  /**
   * Which questions the engine may draw from. Omit or send an empty list for no
   * restriction, which is the default — the engine then uses everything visible
   * to the organisation. A curated pool narrows the choices without replacing
   * them: the test still adapts question by question within it.
   */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  questionIds?: string[];
}
