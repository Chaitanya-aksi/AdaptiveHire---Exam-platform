import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

/**
 * Which business in the group a round is for.
 *
 * `null` is a meaningful value here rather than an omission: it returns the
 * assessment to the workspace's own branding, which is the only way to undo a
 * company having been chosen. So the field is required in the body and may be
 * null, unlike the create DTO where leaving it out is the same as never
 * choosing one.
 */
export class SetCompanyDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  companyId!: string | null;
}
