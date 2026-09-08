import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

/**
 * Shared shape for creating and updating a company. `CreateCompanyDto` below
 * makes the name required; on the update path every field is optional and an
 * explicit `null` clears it.
 */
export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  /**
   * Absolute https URL of the logo, or null to fall back to an initial badge.
   *
   * https only, for the same reason the organisation's logo is: the candidate
   * portal is served over https, so an http image is not a preference to
   * respect, it is a logo that will silently fail to load.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Length(0, 2048)
  logoUrl?: string | null;

  /**
   * `#rrggbb`, or null to inherit the organisation's accent.
   *
   * A literal hex triplet rather than any CSS colour string. This value is
   * interpolated into a `style` attribute on a page candidates are shown, and
   * "whatever a customer typed" reaching a stylesheet is how a branding field
   * turns into an injection point.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'accentColor must be a hex colour such as #2f5bea',
  })
  accentColor?: string | null;

  /** Null falls back to the organisation's address, then the platform's. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEmail()
  supportEmail?: string | null;

  /**
   * False retires the company: it leaves the assessment picker but stays on
   * every assessment and report that already names it.
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCompanyDto extends UpdateCompanyDto {
  @IsString()
  @Length(1, 200)
  declare name: string;
}
