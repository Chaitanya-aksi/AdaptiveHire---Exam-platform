import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateModuleDto } from './create-module.dto';

/**
 * `slug` and `scoringType` are immutable: questions and assessment_modules
 * already reference this row, and flipping the scoring type would orphan every
 * child detail row attached to its questions.
 */
export class UpdateModuleDto extends PartialType(
  OmitType(CreateModuleDto, ['slug', 'scoringType'] as const),
) {}
