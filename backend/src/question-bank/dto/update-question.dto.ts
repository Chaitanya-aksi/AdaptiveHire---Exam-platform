import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateQuestionDto } from './create-question.dto';

/**
 * `moduleId` is immutable — moving a question between modules could switch its
 * scoring type and orphan the child detail row. Delete and recreate instead.
 */
export class UpdateQuestionDto extends PartialType(
  OmitType(CreateQuestionDto, ['moduleId'] as const),
) {}
