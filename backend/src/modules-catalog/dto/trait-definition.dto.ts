import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class TraitDefinitionDto {
  /** Engine-facing key referenced by every option's trait weights. */
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message:
      'trait key must be lower_snake_case (letters, digits and underscores)',
  })
  @Length(2, 60)
  key!: string;

  @IsString()
  @Length(2, 120)
  label!: string;

  @IsOptional()
  @IsBoolean()
  invertForReport?: boolean;
}
