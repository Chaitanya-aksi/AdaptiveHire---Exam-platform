import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
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
}
